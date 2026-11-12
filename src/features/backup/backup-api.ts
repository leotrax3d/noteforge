// Sicherungen (SPEC §10.1): alles über Tauri-Commands; im Browser nur Platzhalter.
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "@/lib/api";
import type { CanvasElement } from "@/lib/types";

export interface BackupConfig { dir: string | null; daily: number; weekly: number; monthly: number }
export interface BackupInfo { name: string; size: number; created: number }
export interface BackupState { config: BackupConfig; dir: string; defaultDir: string; backups: BackupInfo[] }
export interface PreviewPage { id: string; title: string; elements: number; updatedAt: number; current: "same" | "changed" | "missing" }
export interface PreviewSubject { id: string; name: string; color: string; sections: { id: string; name: string; pages: PreviewPage[] }[] }
export interface RestoreScope { all?: boolean; subjects?: string[]; pages?: string[] }

const demo: BackupState = { config: { dir: null, daily: 7, weekly: 4, monthly: 6 }, dir: "", defaultDir: "", backups: [] };
const NA = "Sicherungen sind nur in der Windows-App verfügbar";

export const backupApi = {
  state: (): Promise<BackupState> => (inTauri ? invoke("backup_state") : Promise.resolve(demo)),
  setConfig: (config: BackupConfig): Promise<BackupState> => (inTauri ? invoke("set_backup_config", { config }) : Promise.resolve({ ...demo, config })),
  create: (): Promise<BackupState> => (inTauri ? invoke("backup_create") : Promise.reject(new Error(NA))),
  preview: (name: string): Promise<PreviewSubject[]> => invoke("backup_preview", { name }),
  pageElements: (name: string, pageId: string): Promise<CanvasElement[]> => invoke("backup_page_elements", { name, pageId }),
  restore: (name: string, scope: RestoreScope): Promise<number> => invoke("backup_restore", { name, scope }),
  async pickDir(): Promise<string | null> {
    if (!inTauri) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ directory: true, title: "Sicherungsordner wählen" });
    return typeof r === "string" ? r : null;
  },
};
