// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { HomeworkRow } from "./HomeworkPage";
import { useMappingDialog } from "@/lib/integrations";
import { emptyHomework, type Homework } from "@/lib/school";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
afterEach(() => host?.remove());

function render(h: Homework, subject?: { id: string; name: string; color: string }) {
  host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<ul><HomeworkRow h={h} now={Date.now()} onToggle={() => {}} onEdit={() => {}}
    subject={subject ? { ...subject, icon: "", order: 0, webuntisSubjectId: 1, moodleCourseId: null } : undefined} /></ul>));
  return host;
}

const untisHw = (p: Partial<Homework>): Homework => ({
  ...emptyHomework(null), id: "untis:1", source: "webuntis", title: "Lies das Kapitel…",
  note: "Lies das Kapitel über die Weimarer Republik\nFragen 1–5", untisSubject: "G", teacher: "Mül", assignedAt: Date.now() - 86_400_000, ...p,
});

describe("HomeworkRow", () => {
  it("zeigt Fach-Label, Metadaten und klappt den vollständigen Text auf", () => {
    const el = render(untisHw({ subjectId: "s1" }), { id: "s1", name: "Geschichte", color: "#c00" });
    expect(el.querySelector("[data-testid=subject-badge]")?.textContent).toBe("Geschichte");
    expect(el.querySelector("[data-testid=hw-teacher]")?.textContent).toBe("Mül");
    expect(el.querySelector("[data-testid=hw-assigned]")?.textContent).toMatch(/^Aufgegeben /);
    expect(el.textContent).toContain("Fragen 1–5");
    expect(el.textContent!.match(/Lies das Kapitel/g)).toHaveLength(1);
    const btn = el.querySelector<HTMLButtonElement>("button[aria-label='Ganzen Text zeigen']")!;
    act(() => btn.click());
    expect(el.querySelector("[data-testid=hw-fulltext]")?.textContent).toBe("Lies das Kapitel über die Weimarer Republik\nFragen 1–5");
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.getAttribute("aria-label")).toBe("Text einklappen");
  });

  it("kennzeichnet fehlende Zuordnung und öffnet den Zuordnungsdialog", () => {
    const el = render(untisHw({ subjectId: null }));
    const b = el.querySelector<HTMLButtonElement>("[data-testid=subject-unmapped]")!;
    expect(b.textContent).toContain("Nicht zugeordnet");
    act(() => b.click());
    expect(useMappingDialog.getState()).toMatchObject({ open: true, focus: "G" });
  });

  it("ohne Zusatztext kein Aufklappen", () => {
    const el = render({ ...emptyHomework(null), id: "x", title: "S. 3", note: "S. 3" });
    expect(el.querySelector("button[aria-label='Ganzen Text zeigen']")).toBeNull();
  });
});
