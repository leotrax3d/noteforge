import { integrations, syncNow, useSyncRev, type Lesson } from "@/lib/integrations";
import { useAsync } from "@/lib/use-async";
import { useEffect } from "react";

const DAY = 86_400_000;

/** Stundenplan aus dem lokalen Cache (offline nutzbar): gestern bis +3 Wochen; lädt nach jedem Abgleich neu. */
export function useLessonWindow(now: number, deps: unknown[] = []): { connected: boolean; lessons: Lesson[] } | undefined {
  const rev = useSyncRev((s) => s.rev);
  const d = new Date(now);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const { data } = useAsync(async () => {
    const st = await integrations.status();
    return { connected: !!st.untis, lessons: st.untis ? await integrations.listLessons(day - DAY, day + 21 * DAY) : [] };
  }, [day, rev, ...deps]);
  return data ?? undefined;
}

/** Bei bestehender Verbindung abgleichen (Backend drosselt auf 15 min), auch beim Wiederkommen ins Netz. */
export function useAutoSync() {
  useEffect(() => {
    const run = () => void syncNow(false).catch(() => {});
    run();
    window.addEventListener("online", run);
    const t = window.setInterval(run, 15 * 60_000);
    return () => { window.removeEventListener("online", run); window.clearInterval(t); };
  }, []);
}
