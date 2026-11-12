// Absturzschutz (SPEC §10.2): Änderungen gebündelt ins Write-Ahead-Journal (Rust, fsync), bevor sie
// regulär gespeichert werden. Im Browser (Demo/Tests) ohne Wirkung.
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./api";
import type { CanvasElement } from "./types";

const session = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
let seq = 0;

export const journal = {
  /** Schreibt einen Stand; liefert die laufende Nummer. */
  async write(pageId: string, upserts: CanvasElement[], deletes: string[]): Promise<number> {
    const n = ++seq;
    if (inTauri) await invoke("journal_write", { entry: { session, seq: n, pageId, upserts, deletes } });
    return n;
  },
  /** Alles bis `upTo` ist in SQLite gespeichert. */
  async commit(pageId: string, upTo: number) {
    if (inTauri && upTo > 0) await invoke("journal_commit", { session, pageId, upTo });
  },
  current: () => seq,
  recovered: (): Promise<number> => (inTauri ? invoke<number>("journal_recovered") : Promise.resolve(0)),
};
