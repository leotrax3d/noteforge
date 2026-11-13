import { describe, expect, it } from "vitest";
import * as T from "./table-ops";
import { recase } from "./TextMenu";
import { sanitizeHtml } from "./sanitize";

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe("Tabellen", () => {
  it("legt beliebige Größen an (begrenzt)", () => {
    expect(T.newTable(5, 7).cells.length).toBe(5);
    expect(T.newTable(5, 7).cells[0].length).toBe(7);
    expect(T.newTable(0, 999).cells[0].length).toBe(T.MAX_COLS);
  });

  it("verschiebt Spaltentrenner, Gesamtbreite bleibt", () => {
    const t = T.resizeCol(T.newTable(2, 3), 0, 0.1);
    const w = T.colWidths(t);
    expect(w[0]).toBeCloseTo(1 / 3 + 0.1);
    expect(w[1]).toBeCloseTo(1 / 3 - 0.1);
    expect(sum(w)).toBeCloseTo(1);
    const tight = T.resizeCol(t, 0, 5);
    expect(T.colWidths(tight)[1]).toBeCloseTo(T.MIN_COL);
  });

  it("Zeilen/Spalten einfügen, löschen, verschieben inkl. Breiten und Farben", () => {
    let t = T.setCell(T.newTable(2, 2), 1, 0, "b");
    t = T.setBg(t, [1], [0], "#fef08a");
    t = T.insertRow(t, 1);
    expect(t.cells[2][0]).toBe("b");
    expect(t.bg?.[2][0]).toBe("#fef08a");
    t = T.moveRow(t, 2, -1);
    expect(t.cells[1][0]).toBe("b");
    t = T.resizeCol(t, 0, 0.2);
    t = T.insertCol(t, 0);
    expect(T.colCount(t)).toBe(3);
    expect(sum(T.colWidths(t))).toBeCloseTo(1);
    expect(t.cells[1][1]).toBe("b");
    t = T.deleteCol(t, 0);
    expect(T.colWidths(t).length).toBe(2);
    expect(T.deleteRow(T.newTable(1, 1), 0).cells.length).toBe(1);
  });

  it("sortiert numerisch/alphabetisch, Kopfzeile bleibt", () => {
    const t = { cells: [["Name"], ["10"], ["9"], [""], ["2,5"]] };
    expect(T.sortBy(t, 0).cells.map((r) => r[0])).toEqual(["Name", "2,5", "9", "10", ""]);
    expect(T.sortBy(t, 0, true).cells.map((r) => r[0])).toEqual(["Name", "10", "9", "2,5", ""]);
  });

  it("Summe, Zahlen, Umwandlung", () => {
    const t = { cells: [["Preis"], ["1.200,50 €"], ["<b>3</b>"], [""]] };
    expect(T.sumAbove(t, 3, 0)).toBeCloseTo(1203.5);
    expect(T.parseNum("abc")).toBeNull();
    expect(T.textToTable("a\tb\nc\td")?.cells).toEqual([["a", "b"], ["c", "d"]]);
    expect(T.textToTable("nur text")).toBeNull();
    expect(T.tableToText({ cells: [["a", "b<br>c"]] })).toBe("a\tb c");
  });
});

describe("Textbearbeitung", () => {
  it("Groß-/Kleinschreibung", () => {
    expect(recase("hallo welt. neuer satz", "sentence")).toBe("Hallo welt. Neuer satz");
    expect(recase("straße", "upper")).toBe("STRASSE");
    expect(recase("das ist gut", "title")).toBe("Das Ist Gut");
    expect(recase("AbC", "toggle")).toBe("aBc");
  });

  it("Sanitizer behält Ausrichtung, Marker, Durchstreichen; verwirft Gefährliches", () => {
    const out = sanitizeHtml('<div style="text-align: center; position: fixed">x</div><span style="background-color: #fef08a">m</span><strike>s</strike><span style="background: url(x)">u</span><font size="5">g</font>');
    expect(out).toContain('style="text-align: center"');
    expect(out).toContain("background-color: #fef08a");
    expect(out).toContain("<strike>s</strike>");
    expect(out).not.toContain("url(");
    expect(out).toContain('size="5"');
  });
});
