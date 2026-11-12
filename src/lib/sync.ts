// Phase 8: Nextcloud-Sync (SPEC §9) + Backup. Netzwerk, Konfliktlösung und Zugangsdaten liegen im
// Rust-Backend; das Frontend zeigt nur den Status und reagiert auf geänderte Blätter.
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { inTauri } from "./api";

export interface CloudConfig { server: string; username: string; folder: string; intervalMin: number }
export interface CloudReport {
  uploaded: number; downloaded: number; deleted: number; conflicts: number;
  structureChanged: boolean; changedPages: string[]; errors: string[];
  /** Serverzeit − Gerätezeit in ms */
  clockOffsetMs: number | null;
  finishedAt: number;
}
export interface BackupInfo { name: string; size: number; created: number }
export interface CloudStatus {
  config: CloudConfig | null;
  running: boolean;
  last: CloudReport | null;
  lastError: string | null;
  device: string;
  backups: BackupInfo[];
  backupDir: string;
  clockWarnMs: number;
}

export interface CloudSync {
  status(): Promise<CloudStatus>;
  connect(c: CloudConfig & { password: string }): Promise<CloudStatus>;
  disconnect(): Promise<CloudStatus>;
  syncNow(): Promise<CloudReport | null>;
  backupNow(): Promise<CloudStatus>;
}

const tauriSync: CloudSync = {
  status: () => invoke("sync_status"),
  connect: ({ server, username, password, folder, intervalMin }) => invoke("sync_connect", { server, username, password, folder, intervalMin }),
  disconnect: () => invoke("sync_disconnect"),
  syncNow: () => invoke("sync_now"),
  backupNow: () => invoke("backup_now"),
};

/** Browser/Tests: kein Netzwerk, aber ein bedienbarer Ablauf. */
class DemoSync implements CloudSync {
  private st: CloudStatus = {
    config: null, running: false, last: null, lastError: null, device: "Browser",
    backups: [], backupDir: "%APPDATA%\\de.noteforge.app\\backups", clockWarnMs: 120_000,
  };
  async status() { return structuredClone(this.st); }
  async connect(c: CloudConfig & { password: string }) {
    if (!/^https?:\/\//.test(c.server.trim())) throw new Error("Die Server-Adresse muss mit https:// beginnen");
    if (!c.username.trim()) throw new Error("Benutzername fehlt");
    if (!c.password && !this.st.config) throw new Error("App-Passwort fehlt");
    const { password: _, ...cfg } = c;
    this.st.config = cfg;
    return this.status();
  }
  async disconnect() { this.st.config = null; this.st.last = null; return this.status(); }
  async syncNow() {
    if (!this.st.config) return null;
    const r: CloudReport = { uploaded: 0, downloaded: 0, deleted: 0, conflicts: 0, structureChanged: false, changedPages: [], errors: [], clockOffsetMs: 0, finishedAt: Date.now() };
    this.st.last = r;
    return r;
  }
  async backupNow() {
    const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
    this.st.backups.unshift({ name: `noteforge-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.sqlite`, size: 1_234_567, created: d.getTime() });
    return this.status();
  }
}

export const cloud: CloudSync = inTauri ? tauriSync : new DemoSync();

/** Zähler + zuletzt geänderte Blätter: Ansichten laden nach einem Sync neu. */
interface CloudRev { rev: number; pages: Set<string>; structure: boolean; running: boolean; error: string | null; apply: (r: CloudReport) => void; setRunning: (v: boolean) => void; fail: (e: string) => void }
export const useCloudRev = create<CloudRev>((set) => ({
  rev: 0, pages: new Set(), structure: false, running: false, error: null,
  apply: (r) => set((s) => {
    const changed = r.changedPages.length > 0 || r.structureChanged;
    return { error: r.errors[0] ?? null, running: false, ...(changed ? { rev: s.rev + 1, pages: new Set(r.changedPages), structure: r.structureChanged } : {}) };
  }),
  setRunning: (running) => set({ running }),
  fail: (error) => set({ error, running: false }),
}));

export async function syncNowAndApply(): Promise<CloudReport | null> {
  const st = useCloudRev.getState();
  st.setRunning(true);
  try {
    const r = await cloud.syncNow();
    if (r) useCloudRev.getState().apply(r);
    else useCloudRev.getState().setRunning(false);
    return r;
  } catch (e) {
    useCloudRev.getState().fail(String(e).replace(/^Error: /, ""));
    throw e;
  }
}

/** Hintergrund-Syncs des Backends (Ereignisse) an die Ansichten weiterreichen. */
export async function listenCloud(): Promise<() => void> {
  if (!inTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const a = await listen<CloudReport>("sync-finished", (e) => useCloudRev.getState().apply(e.payload));
  const b = await listen<string>("sync-failed", (e) => useCloudRev.getState().fail(e.payload));
  return () => { a(); b(); };
}

/** „Die Uhr dieses Geräts geht 3 Min. 20 Sek. vor“ */
export function clockText(offsetMs: number): string {
  const ahead = offsetMs < 0; // Server − Gerät < 0 → Gerät geht vor
  let s = Math.round(Math.abs(offsetMs) / 1000);
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const parts = [h && `${h} Std.`, m && `${m} Min.`, (!h && s) && `${s} Sek.`].filter(Boolean);
  return `Die Uhr dieses Geräts geht ${parts.join(" ") || "0 Sek."} ${ahead ? "vor" : "nach"}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1).replace(".", ",")} MB`;
}
