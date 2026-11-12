// Tauri-Commands des Einrichtungsassistenten (Speicherort, App-Einstellungen, Schulsuche).
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./api";

export interface DataLocation { current: string; suggested: string }
export interface DirCheck { writable: boolean; cloud: string | null; hasData: boolean; error: string | null }
export interface School { name: string; address: string; server: string; login: string }

const mem = new Map<string, string>();

export const setupApi = {
  dataLocation: (): Promise<DataLocation> =>
    inTauri ? invoke("data_location") : Promise.resolve({ current: "(Browser-Speicher)", suggested: "C:\\Users\\Du\\Documents\\Noteforge" }),
  checkDir: (path: string): Promise<DirCheck> =>
    inTauri ? invoke("check_data_dir", { path }) : Promise.resolve({ writable: true, cloud: /onedrive|nextcloud|dropbox/i.test(path) ? "Cloud" : null, hasData: false, error: null }),
  /** true = Neustart nötig */
  setDir: (path: string): Promise<boolean> => (inTauri ? invoke("set_data_dir", { path }) : Promise.resolve(false)),
  restart: (): Promise<void> => (inTauri ? invoke("restart_app") : Promise.resolve(location.reload())),
  pickDir: async (defaultPath?: string): Promise<string | null> => {
    if (!inTauri) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ directory: true, multiple: false, defaultPath, title: "Speicherort für Noteforge wählen" });
    return typeof r === "string" ? r : null;
  },
  settings: (): Promise<Record<string, string>> => (inTauri ? invoke("app_settings") : Promise.resolve(Object.fromEntries(mem))),
  setSetting: (key: `app.${string}`, value: string): Promise<void> =>
    inTauri ? invoke("set_app_setting", { key, value }) : Promise.resolve(void mem.set(key, value)),
  searchSchools: (query: string): Promise<School[]> =>
    inTauri ? invoke("untis_search_schools", { query })
      : Promise.resolve(query.length < 3 ? [] : [{ name: `Demo-Gymnasium ${query}`, address: "Musterstadt", server: "demo.webuntis.com", login: "demo" }]),
};

/** Benachrichtigungen erlauben (Windows fragt ggf. nach). */
export async function requestNotifications(): Promise<boolean> {
  if (!inTauri) return "Notification" in window ? (await Notification.requestPermission()) === "granted" : false;
  const n = await import("@tauri-apps/plugin-notification");
  if (await n.isPermissionGranted()) return true;
  return (await n.requestPermission()) === "granted";
}
