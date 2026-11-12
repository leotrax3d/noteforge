import { describe, expect, it } from "vitest";
import { titleFromText, titleFromTexts } from "./auto-title";

describe("auto-title", () => {
  it("nimmt drei Wörter ohne Satzzeichen am Ende", () => {
    expect(titleFromText("Die Photosynthese, eine Reaktion")).toBe("Die Photosynthese, eine");
    expect(titleFromText("Hebelgesetz!")).toBe("Hebelgesetz");
    expect(titleFromText("  a,  ")).toBe("a");
    expect(titleFromText("— — …")).toBe("");
  });
  it("kürzt auf 40 Zeichen", () => {
    expect(titleFromText("Donaudampfschifffahrtsgesellschaftskapitänsmütze Hut Kopf").length).toBeLessThanOrEqual(40);
  });
  it("liest oben links zuerst", () => {
    const t = titleFromTexts([
      { bbox: { x: 300, y: 10, w: 100, h: 30 }, html: "<p>rechts</p>" },
      { bbox: { x: 0, y: 200, w: 100, h: 30 }, html: "unten" },
      { bbox: { x: 0, y: 12, w: 100, h: 30 }, html: "<p>Links&nbsp;oben</p>" },
    ]);
    expect(t).toBe("Links oben");
  });
});
