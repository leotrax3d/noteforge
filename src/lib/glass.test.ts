import { describe, expect, it } from "vitest";
import { backdropColors, contrast, effective, GLASS_DEFAULTS, hexToRgb, mix, safeOpacity, TEST_BACKDROPS, TINT } from "./glass";

describe("Glas-Kontrast (WCAG AA)", () => {
  it("berechnet Kontraste wie WCAG", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
    expect(contrast(hexToRgb("#777"), hexToRgb("#fff"))).toBeCloseTo(4.48, 1);
  });
  for (const mode of ["light", "dark"] as const) {
    for (const stops of TEST_BACKDROPS) {
      it(`${mode} / ${stops.join(",")}: Text und gedämpfter Text ≥ 4,5:1 bei jeder Benutzer-Deckkraft`, () => {
        const backs = backdropColors(stops, mode);
        for (const wanted of [0.2, 0.4, 0.55, 0.8]) {
          const a = safeOpacity(wanted, backs, mode);
          expect(a).toBeGreaterThanOrEqual(wanted);
          for (const b of backs) {
            const surf = mix(TINT[mode].glass, b, a);
            expect(contrast(TINT[mode].text, surf)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(TINT[mode].muted, surf)).toBeGreaterThanOrEqual(4.5);
          }
        }
      });
    }
  }
  it("Akkumodus reduziert bzw. deaktiviert den Blur, ohne Blur wird es deckender", () => {
    const s = { ...GLASS_DEFAULTS, enabled: true, customStops: [], systemBlocked: false, set: () => {} };
    expect(effective(s, "dark", true).blur).toBe(8);
    expect(effective({ ...s, saverBlur: "off" }, "dark", true).blur).toBe(0);
    expect(effective({ ...s, saverBlur: "off" }, "dark", true).opacity).toBeGreaterThanOrEqual(0.85);
    expect(effective(s, "dark", false, false).blur).toBe(0);
    expect(effective(s, "dark", false).blur).toBe(24);
  });
});
