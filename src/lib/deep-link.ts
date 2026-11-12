// noteforge://-Links aus Google-Terminen (SPEC §8.3): page/<id>, subject/<id>, calendar, homework.
import { inTauri, api } from "./api";
import { useNav, type Route } from "@/store/nav";

export type Target =
  | { kind: "page"; id: string }
  | { kind: "subject"; id: string }
  | { kind: "calendar" }
  | { kind: "homework" };

export function parseLink(url: string): Target | null {
  const m = /^noteforge:\/\/+([a-z]+)\/?([^/?#]*)/i.exec(url.trim());
  if (!m) return null;
  const [, kind, raw] = m;
  const id = decodeURIComponent(raw);
  switch (kind.toLowerCase()) {
    case "page": return id ? { kind: "page", id } : null;
    case "subject": return id ? { kind: "subject", id } : null;
    case "calendar": return { kind: "calendar" };
    case "homework": return { kind: "homework" };
    default: return null;
  }
}

export async function routeFor(t: Target): Promise<Route | null> {
  switch (t.kind) {
    case "page": {
      const ref = (await api.listPageRefs()).find((p) => p.pageId === t.id);
      return ref ? { view: "subject", subjectId: ref.subjectId, pageId: ref.pageId } : null;
    }
    case "subject": return { view: "subject", subjectId: t.id, pageId: null };
    case "calendar": return { view: "calendar" };
    case "homework": return { view: "homework" };
  }
}

export async function openLink(url: string) {
  const t = parseLink(url);
  const r = t && (await routeFor(t));
  if (r) useNav.getState().go(r);
}

/** Links beim Start und während die App läuft empfangen. */
export async function listenDeepLinks(): Promise<() => void> {
  if (!inTauri) return () => {};
  const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
  const first = await getCurrent().catch(() => null);
  if (first?.[0]) void openLink(first[0]);
  return onOpenUrl((urls) => { if (urls[0]) void openLink(urls[0]); });
}
