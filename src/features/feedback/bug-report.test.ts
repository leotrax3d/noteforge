import { describe, expect, it, vi } from "vitest";
import { BUG_MAX, shotScale, submitBugReport, validateBugReport } from "./bug-report";

describe("Bug-Report", () => {
  it("prüft die Länge wie die Datenbank", () => {
    expect(validateBugReport("   kurz   ")).toMatch(/mindestens/);
    expect(validateBugReport("x".repeat(BUG_MAX + 1))).toMatch(/höchstens/);
    expect(validateBugReport("Kalender stürzt ab")).toBeNull();
  });
  it("sendet getrimmt und gibt die Erfolgsmeldung zurück", async () => {
    const send = vi.fn().mockResolvedValue("Danke!");
    await expect(submitBugReport("  Kalender stürzt ab \n", null, send)).resolves.toBe("Danke!");
    expect(send).toHaveBeenCalledWith("Kalender stürzt ab", null);
    await submitBugReport("Kalender stürzt ab", "data:image/jpeg;base64,AAA", send);
    expect(send).toHaveBeenLastCalledWith("Kalender stürzt ab", "data:image/jpeg;base64,AAA");
  });
  it("sendet ungültige Eingaben nicht und reicht Serverfehler als Text weiter", async () => {
    const send = vi.fn();
    await expect(submitBugReport("kurz", null, send)).rejects.toThrow(/mindestens/);
    expect(send).not.toHaveBeenCalled();
    await expect(submitBugReport("Kalender stürzt ab", null, () => Promise.reject("Keine Verbindung zum Server"))).rejects.toThrow("Keine Verbindung zum Server");
  });
});

describe("Bildschirmfoto", () => {
  it("verkleinert nur große Ansichten", () => {
    expect(shotScale(1280, 800)).toBe(1);
    expect(shotScale(3200, 1800)).toBe(0.5);
    expect(shotScale(1000, 4000, 1600)).toBe(0.4);
  });
});
