import { describe, expect, it } from "vitest";
import { filterCommands, type Command } from "./CommandPalette";

const c = (id: string, label: string, words = ""): Command => ({ id, label, group: "G", words, run: () => {} });

describe("Befehlspalette", () => {
  const cmds = [c("a", "Startseite"), c("b", "Hausaufgaben"), c("c", "Design: Dunkel", "theme nacht"), c("d", "Noten", "notenrechner")];
  it("findet über Zusatzwörter und ohne Umlaute", () => {
    expect(filterCommands(cmds, "nacht").map((x) => x.id)).toEqual(["c"]);
    expect(filterCommands([c("u", "Überspringen")], "uber").length).toBe(1);
  });
  it("Wortanfang zuerst", () => {
    expect(filterCommands(cmds, "no")[0].id).toBe("d");
  });
  it("leere Suche zeigt alles", () => {
    expect(filterCommands(cmds, "").length).toBe(4);
  });
});
