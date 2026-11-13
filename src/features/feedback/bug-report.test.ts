import { describe, expect, it, vi } from "vitest";
import { BUG_MAX, submitBugReport, validateBugReport } from "./bug-report";

describe("Bug-Report", () => {
  it("prüft die Länge wie die Datenbank", () => {
    expect(validateBugReport("   kurz   ")).toMatch(/mindestens/);
    expect(validateBugReport("x".repeat(BUG_MAX + 1))).toMatch(/höchstens/);
    expect(validateBugReport("Kalender stürzt ab")).toBeNull();
  });
  it("sendet getrimmt und gibt die Erfolgsmeldung zurück", async () => {
    const send = vi.fn().mockResolvedValue("Danke!");
    await expect(submitBugReport("  Kalender stürzt ab \n", send)).resolves.toBe("Danke!");
    expect(send).toHaveBeenCalledWith("Kalender stürzt ab");
  });
  it("sendet ungültige Eingaben nicht und reicht Serverfehler als Text weiter", async () => {
    const send = vi.fn();
    await expect(submitBugReport("kurz", send)).rejects.toThrow(/mindestens/);
    expect(send).not.toHaveBeenCalled();
    await expect(submitBugReport("Kalender stürzt ab", () => Promise.reject("Keine Verbindung zum Server"))).rejects.toThrow("Keine Verbindung zum Server");
  });
});
