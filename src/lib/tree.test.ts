import { describe, expect, it } from "vitest";
import { MemoryBackend } from "./memory-backend";
import { flattenSection, indentTarget, outdentTarget, pageDropTarget } from "./tree";

async function setup() {
  const b = new MemoryBackend();
  const s = await b.createSubject("Mathe", "#2563eb", "calculator");
  const sec = await b.createSection(s.id, "Analysis", "#2563eb");
  const sec2 = await b.createSection(s.id, "Geometrie", "#2563eb");
  const a = await b.createPage(sec.id, null, "A");
  const bb = await b.createPage(sec.id, null, "B");
  const c = await b.createPage(sec.id, null, "C");
  const a1 = await b.createPage(sec.id, a.id, "A1");
  return { b, s, sec, sec2, a, bb, c, a1 };
}

const titles = (b: MemoryBackend, sectionId: string) =>
  flattenSection(b.pages, sectionId).map((f) => "  ".repeat(f.depth) + f.page.title);

describe("Seitenbaum", () => {
  it("flacht in Tiefensuche ab und respektiert Einklappen", async () => {
    const { b, sec, a } = await setup();
    expect(titles(b, sec.id)).toEqual(["A", "  A1", "B", "C"]);
    expect(flattenSection(b.pages, sec.id, new Set([a.id])).map((f) => f.page.title)).toEqual(["A", "B", "C"]);
  });

  it("verschiebt per Drop nach unten und oben", async () => {
    const { b, sec, a, c } = await setup();
    let t = pageDropTarget(b.pages, a.id, c.id, false)!;
    expect(t).toEqual({ sectionId: sec.id, parentPageId: null, index: 2 });
    await b.movePage(a.id, t.sectionId, t.parentPageId, t.index);
    expect(titles(b, sec.id)).toEqual(["B", "C", "A", "  A1"]);

    t = pageDropTarget(b.pages, a.id, b.pages.find((p) => p.title === "B")!.id, false)!;
    await b.movePage(a.id, t.sectionId, t.parentPageId, t.index);
    expect(titles(b, sec.id)).toEqual(["A", "  A1", "B", "C"]);
  });

  it("verschachtelt, rückt ein/aus und verhindert Zyklen", async () => {
    const { b, sec, a, bb, c, a1 } = await setup();
    expect(pageDropTarget(b.pages, a.id, a1.id, true)).toBeNull();
    expect(pageDropTarget(b.pages, a.id, a.id, false)).toBeNull();

    let t = pageDropTarget(b.pages, c.id, a.id, true)!;
    await b.movePage(c.id, t.sectionId, t.parentPageId, t.index);
    expect(titles(b, sec.id)).toEqual(["A", "  A1", "  C", "B"]);

    t = outdentTarget(b.pages, c.id)!;
    await b.movePage(c.id, t.sectionId, t.parentPageId, t.index);
    expect(titles(b, sec.id)).toEqual(["A", "  A1", "C", "B"]);

    t = indentTarget(b.pages, bb.id)!;
    await b.movePage(bb.id, t.sectionId, t.parentPageId, t.index);
    expect(titles(b, sec.id)).toEqual(["A", "  A1", "C", "  B"]);
    expect(indentTarget(b.pages, a.id)).toBeNull();
  });

  it("nimmt Unterseiten beim Gruppenwechsel mit", async () => {
    const { b, sec, sec2, a, bb } = await setup();
    await b.movePage(a.id, sec2.id, null, 0);
    expect(titles(b, sec2.id)).toEqual(["A", "  A1"]);
    expect(titles(b, sec.id)).toEqual(["B", "C"]);
    expect(b.pages.find((p) => p.id === bb.id)!.order).toBe(0);
  });

  it("löscht Fächer kaskadierend", async () => {
    const { b, s } = await setup();
    await b.deleteSubject(s.id);
    expect(b.pages).toHaveLength(0);
    expect(b.sections).toHaveLength(0);
  });
});
