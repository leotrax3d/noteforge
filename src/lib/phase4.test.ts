import { describe, expect, it } from "vitest";
import { MemoryBackend } from "./memory-backend";
import { elementText, findLinks, stripHtml } from "./text";
import { buildPdf, pdfText } from "@/canvas/export/pdf";
import { htmlToBlocks, planSheets } from "@/canvas/export/render";
import { buildTimeline, stateAt, GAP_MS } from "@/canvas/tools/replay";
import { makeStroke, PSTRIDE } from "@/canvas/core/model";
import { makeObj, objToElement, elementToObj, type ImageObj, type TextObj } from "@/canvas/core/objects";
import { linkifyHtml, sanitizeHtml } from "@/features/canvas/objects/sanitize";
import { BUILTIN_TEMPLATES } from "@/features/pages/templates";
import { firstFreeA4, layoutPdfPages } from "@/features/pages/pdf-import";
import { a4PageRect, a4Size } from "@/canvas/core/layout";
import type { CanvasElement } from "./types";

const textEl = (pageId: string, id: string, html: string): CanvasElement =>
  objToElement(makeObj<TextObj>({ id, kind: "text", z: 0, x: 0, y: 0, w: 100, h: 40, angle: 0, data: { html } }), pageId);

async function fx() {
  const b = new MemoryBackend();
  const s = await b.createSubject("Bio", "#0f0", "leaf");
  const sec = await b.createSection(s.id, "Zelle", "#0f0");
  return { b, s, sec };
}

describe("Papierkorb (Browser-Backend)", () => {
  it("löscht weich, stellt wieder her und leert", async () => {
    const { b, s, sec } = await fx();
    const a = await b.createPage(sec.id, null, "A");
    const a1 = await b.createPage(sec.id, a.id, "A1");
    await b.deletePage(a.id);
    expect(await b.listPages(s.id)).toHaveLength(0);
    const t = await b.listTrash(s.id);
    expect(t.map((x) => [x.page.title, x.childCount])).toEqual([["A", 1]]);
    await b.restorePage(a.id);
    expect((await b.listPages(s.id)).map((p) => p.id)).toEqual([a.id, a1.id]);
    await b.deletePage(a1.id);
    await expect(b.purgePage(a.id)).rejects.toThrow();
    expect(await b.emptyTrash(s.id)).toBe(1);
    expect(await b.listTrash(s.id)).toEqual([]);
  });
});

describe("Suche, Links, Tags, Versionen, Vorlagen (Browser-Backend)", () => {
  it("findet Text ohne Diakritika und markiert Treffer", async () => {
    const { b, sec } = await fx();
    const p = await b.createPage(sec.id, null, "Mitose");
    await b.saveElements(p.id, [textEl(p.id, "t", "<p>Zellkern <b>teilt</b> sich in Phasen</p>")], []);
    const h = await b.search("zellkern PHASE");
    expect(h).toHaveLength(1);
    expect(h[0].snippet).toContain("\u0001Zellkern\u0002");
    expect(await b.search("kern")).toHaveLength(0); // Wortanfang
    expect((await b.findPage("mitose", null))?.pageId).toBe(p.id);
  });

  it("Tags und To-Do-Status", async () => {
    const { b, s, sec } = await fx();
    const p = await b.createPage(sec.id, null, "HA");
    await expect(b.setElementTag("fehlt", "todo", true)).rejects.toThrow();
    await b.saveElements(p.id, [textEl(p.id, "t", "Seite 12 lesen")], []);
    await b.setElementTag("t", "todo", true);
    await b.setTagDone("t", "todo", true);
    const items = await b.listTagged("todo", s.id);
    expect(items.map((i) => [i.snippet, i.done])).toEqual([["Seite 12 lesen", true]]);
    await expect(b.deleteTag("todo")).rejects.toThrow();
    await b.saveElements(p.id, [], ["t"]);
    expect(await b.listPageTags(p.id)).toEqual([]);
  });

  it("Versionen und eigene Vorlagen", async () => {
    const { b, sec } = await fx();
    const p = await b.createPage(sec.id, null, "V");
    expect(await b.autoVersion(p.id, 0)).toBeNull();
    await b.saveElements(p.id, [textEl(p.id, "t1", "eins")], []);
    const v = (await b.autoVersion(p.id, 0))!;
    await b.saveElements(p.id, [textEl(p.id, "t2", "zwei")], ["t1"]);
    await b.restoreVersion(v.id);
    expect((await b.listElements(p.id)).map((e) => e.id)).toEqual(["t1"]);
    expect((await b.listVersions(p.id))[0].label).toBe("Vor der Wiederherstellung");
    const t = await b.saveTemplate(p.id, "Muster");
    const n = await b.createPageFromTemplate(sec.id, null, t.id, "Neu");
    const els = await b.listElements(n.id);
    expect(els).toHaveLength(1);
    expect(els[0].id).not.toBe("t1");
  });
});

describe("Text-Hilfen", () => {
  it("entfernt HTML und findet Seitenlinks", () => {
    expect(stripHtml("<h1>A&amp;B</h1><p>c&nbsp;d</p>")).toBe("A&B c d");
    expect(findLinks("siehe [[Mitose]] und [[ Meiose ]], nicht [[]]")).toEqual(["Mitose", "Meiose"]);
    const cells = new TextEncoder().encode(JSON.stringify({ v: 1, data: { cells: [["<b>a</b>", ""], ["b", "c"]] } }));
    expect(elementText("table", cells)).toBe("a · b · c");
  });

  it("verlinkt [[…]] nur in der Anzeige", () => {
    const html = linkifyHtml("<p>Vgl. [[Ohmsches Gesetz]]!</p>");
    expect(html).toContain('data-link="Ohmsches Gesetz"');
    // Sanitizer macht daraus wieder Klartext mit Klammern
    expect(sanitizeHtml(html)).toBe("<p>Vgl. [[Ohmsches Gesetz]]!</p>");
    expect(linkifyHtml("<p>ohne</p>")).toBe("<p>ohne</p>");
  });
});

describe("PDF", () => {
  it("baut eine gültige Struktur mit korrekter xref-Tabelle", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const bytes = buildPdf([
      { jpeg, px: { w: 10, h: 14 }, mm: { w: 210, h: 297 } },
      { jpeg, px: { w: 14, h: 10 }, mm: { w: 297, h: 210 } },
    ], { title: "Bio – Zelle" });
    const s = new TextDecoder("latin1").decode(bytes);
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s).toContain("/Count 2");
    expect(s).toContain("/MediaBox [0 0 595.28 841.89]");
    expect(s).toContain("/MediaBox [0 0 841.89 595.28]");
    const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(xref, xref + 4)).toBe("xref");
    // Jeder xref-Eintrag zeigt auf "n 0 obj"
    const entries = s.slice(xref).split("\n").slice(3, 3 + 9);
    entries.forEach((e, i) => expect(s.slice(Number(e.slice(0, 10)))).toMatch(new RegExp(`^${i + 1} 0 obj`)));
    expect(pdfText("Ä")).toBe("<FEFF00C4>");
  });

  it("teilt Blätter in A4-Bögen", () => {
    const setup = { mode: "a4" as const, orientation: "portrait" as const, background: "grid" as const, bgSpacingMm: 5, pageColor: "#fff" };
    const r2 = a4PageRect(2, "portrait");
    const s = makeStroke({ id: "s", pen: "ballpoint", color: "#000", width: 2, opacity: 1, pressure: false, z: 0,
      points: new Float32Array([10, r2.y + 10, 0.5, 0, 0, 20, r2.y + 20, 0.5, 0, 10]) });
    expect(planSheets({ setup, strokes: [s], objs: [] })).toHaveLength(3);
    expect(planSheets({ setup, strokes: [], objs: [] })).toHaveLength(1);
    const inf = planSheets({ setup: { ...setup, mode: "infinite" }, strokes: [s], objs: [] });
    expect(inf).toHaveLength(1);
    expect(inf[0].mm).toEqual({ w: 210, h: 297 });
  });

  it("legt importierte Seiten fest in A4-Blätter", () => {
    const pages = [{ src: "data:x", w: 595, h: 842, text: "Hallo" }, { src: "data:y", w: 842, h: 595, text: "" }];
    const objs = layoutPdfPages(pages, { mode: "a4", orientation: "portrait", firstIndex: 1, z: 5 });
    expect(objs.map((o) => o.z)).toEqual([5, 6]);
    expect(objs[0].y).toBeCloseTo(a4PageRect(1, "portrait").y, 0);
    expect(objs[1].w).toBeCloseTo(a4Size("portrait").w, 3); // quer → in Breite eingepasst
    const el = objToElement(objs[0], "p");
    expect(el.type).toBe("pdfPage");
    const back = elementToObj(el) as ImageObj;
    expect(back.data.locked).toBe(true);
    expect(elementText("pdfPage", el.data)).toBe("Hallo");
    expect(firstFreeA4(null, "portrait")).toBe(0);
    expect(firstFreeA4(10, "portrait")).toBe(1);
  });

  it("zerlegt Rich Text in Absätze", () => {
    const b = htmlToBlocks("<h1>Titel</h1><p>a <b>b</b></p><ol><li>x</li><li>y</li></ol>");
    expect(b.map((x) => x.bullet)).toEqual(["", "", "1.", "2."]);
    expect(b[0].runs[0].bold).toBe(true);
    expect(b[1].runs.map((r) => [r.text, r.bold])).toEqual([["a ", false], ["b", true]]);
  });
});

describe("Ink-Wiedergabe", () => {
  const stroke = (z: number, ts: number[]) => {
    const p = new Float32Array(ts.length * PSTRIDE);
    ts.forEach((t, i) => p.set([i, i, 0.5, 0, t], i * PSTRIDE));
    return makeStroke({ id: `s${z}`, pen: "fountain", color: "#000", width: 2, opacity: 1, pressure: true, z, points: p });
  };
  it("folgt Reihenfolge und Schreibtempo", () => {
    const tl = buildTimeline([stroke(1, [0, 100, 200, 400]), stroke(0, [0, 300])]);
    expect(tl.strokes.map((s) => s.id)).toEqual(["s0", "s1"]);
    expect(tl.total).toBe(300 + GAP_MS + 400);
    expect(stateAt(tl, 150)).toEqual({ done: 0, partial: { index: 0, count: 1 } });
    expect(stateAt(tl, 300).done).toBe(1);
    expect(stateAt(tl, 300 + GAP_MS + 150)).toEqual({ done: 1, partial: { index: 1, count: 2 } });
    expect(stateAt(tl, tl.total).done).toBe(2);
    expect(buildTimeline([]).total).toBe(0);
  });
});

describe("Vorlagen", () => {
  it("erzeugen gültige Elemente", () => {
    for (const t of BUILTIN_TEMPLATES) {
      const els = t.build?.("p") ?? [];
      for (const e of els) expect(e.pageId).toBe("p");
      if (t.id === "builtin:vocab") expect(els.some((e) => e.type === "table")).toBe(true);
      if (t.id === "builtin:cornell") expect(els.filter((e) => e.type === "stroke")).toHaveLength(3);
    }
  });
});
