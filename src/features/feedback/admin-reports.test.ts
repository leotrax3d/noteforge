import { describe, expect, it } from "vitest";
// @ts-expect-error – reines JS-Modul des Admin-Dashboards (admin/), ohne Typen
import { countByStatus, errorText, filterReports, fmtDate } from "../../../admin/reports.js";

const r = (id: string, status: string, description: string, app_version = "0.2.16", platform = "windows x86_64") =>
  ({ id, status, description, app_version, platform, created_at: "2026-11-13T14:00:00Z" });
const list = [r("1", "open", "Kalender bleibt weiß"), r("2", "done", "Absturz beim Export"), r("3", "in_progress", "PDF lädt nicht", "0.2.15")];

describe("Admin-Dashboard", () => {
  it("filtert nach Status und Suchtext", () => {
    expect(filterReports(list, { status: "open" }).map((x: { id: string }) => x.id)).toEqual(["1"]);
    expect(filterReports(list, { query: "  absturz " }).map((x: { id: string }) => x.id)).toEqual(["2"]);
    expect(filterReports(list, { query: "0.2.15" }).map((x: { id: string }) => x.id)).toEqual(["3"]);
    expect(filterReports(list, { status: "done", query: "kalender" })).toEqual([]);
    expect(filterReports(list)).toHaveLength(3);
  });
  it("zählt je Status", () => {
    expect(countByStatus(list)).toEqual({ all: 3, open: 1, in_progress: 1, done: 1 });
  });
  it("formatiert Datum und Fehler auf Deutsch", () => {
    expect(fmtDate("kaputt")).toBe("–");
    expect(fmtDate("2026-11-13T14:00:00Z")).toMatch(/2026/);
    expect(errorText({ message: "Invalid login credentials" })).toBe("E-Mail oder Passwort falsch.");
    expect(errorText(new TypeError("Failed to fetch"))).toBe("Keine Verbindung zu Supabase.");
    expect(errorText({ message: "new row violates row-level security policy" })).toBe("Keine Berechtigung.");
  });
});
