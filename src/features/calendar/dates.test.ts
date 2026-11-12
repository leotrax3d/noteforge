import { describe, expect, it } from "vitest";
import { countdown, eventsOn, fromInputs, isoWeek, monthGrid, startOfWeek, toDateInput, toTimeInput } from "./dates";
import { MemoryBackend } from "@/lib/memory-backend";
import type { CalendarEvent } from "@/lib/types";

const ev = (start: number, end: number | null = null): CalendarEvent => ({
  id: "", subjectId: null, type: "exam", title: "KA", start, end, note: "", source: "manual", remindBefore: null,
});

describe("Kalender-Datumslogik", () => {
  it("Woche beginnt Montag", () => {
    expect(startOfWeek(new Date(2026, 10, 12)).getDate()).toBe(9); // Do → Mo 9.11.
    expect(startOfWeek(new Date(2026, 10, 15)).getDate()).toBe(9); // So
  });
  it("Monatsraster hat 42 Tage, beginnt Montag", () => {
    const g = monthGrid(2026, 10);
    expect(g).toHaveLength(42);
    expect(g[0].getDay()).toBe(1);
    expect(g.some((d) => d.getMonth() === 10 && d.getDate() === 1)).toBe(true);
  });
  it("ISO-Kalenderwoche", () => {
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1);
    expect(isoWeek(new Date(2026, 10, 12))).toBe(46);
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53);
  });
  it("Eingabefelder round-trip", () => {
    const t = fromInputs("2026-11-20", "08:45");
    expect(toDateInput(t)).toBe("2026-11-20");
    expect(toTimeInput(t)).toBe("08:45");
  });
  it("Countdown", () => {
    const now = new Date(2026, 10, 12, 10, 0).getTime();
    expect(countdown(new Date(2026, 10, 12, 12, 30).getTime(), now).label).toBe("heute, in 2 Std.");
    expect(countdown(new Date(2026, 10, 13, 8).getTime(), now).label).toBe("morgen");
    expect(countdown(new Date(2026, 10, 19).getTime(), now)).toEqual({ days: 7, label: "in 7 Tagen" });
    expect(countdown(new Date(2026, 11, 24).getTime(), now).label).toBe("in 6 Wochen");
    expect(countdown(new Date(2026, 10, 11).getTime(), now).label).toBe("vorbei");
  });
  it("Mehrtägige Termine erscheinen an jedem Tag", () => {
    const e = ev(new Date(2026, 10, 10, 9).getTime(), new Date(2026, 10, 12, 9).getTime());
    expect(eventsOn([e], new Date(2026, 10, 11))).toHaveLength(1);
    expect(eventsOn([e], new Date(2026, 10, 13))).toHaveLength(0);
  });
});

describe("Termine im Memory-Backend", () => {
  it("anlegen, filtern, ändern, löschen; Fach löschen entkoppelt", async () => {
    const b = new MemoryBackend();
    const s = await b.createSubject("Mathe", "#00f", "calculator");
    const e = await b.saveEvent({ ...ev(1000), subjectId: s.id });
    expect(e.id).not.toBe("");
    expect(await b.listEvents(0, 2000)).toHaveLength(1);
    expect(await b.listEvents(1001, 2000)).toHaveLength(0);
    await b.saveEvent({ ...e, title: "KA 2" });
    expect((await b.listEvents(0, 2000))[0].title).toBe("KA 2");
    await expect(b.saveEvent({ ...e, title: " " })).rejects.toThrow();
    await b.deleteSubject(s.id);
    expect((await b.listEvents(0, 2000))[0].subjectId).toBeNull();
    await b.deleteEvent(e.id);
    expect(await b.listEvents(0, 2000)).toHaveLength(0);
  });
});
