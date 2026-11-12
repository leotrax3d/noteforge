// Phase 7: Erkennung über Tauri-Commands (Windows InkAnalyzer / Windows.Media.Ocr).
// Im Browser (Vite-Demo, Tests) gibt es keine Erkennung – die Aufrufe melden das verständlich.
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./api";

export interface Box { x: number; y: number; w: number; h: number }
export interface RecWord { text: string; bbox: Box }
export interface InkResult { text: string; lines: RecWord[]; words: RecWord[] }
export interface OcrResult extends InkResult { width: number; height: number }
export interface RecStatus { ink: boolean; ocr: boolean; ocrLanguage: string | null }
export interface PageRecognition { inkUpdated: boolean; images: number; unavailable: boolean }

export interface Recognition {
  status(): Promise<RecStatus>;
  /** Punkte je Strich wie im Modell: x, y, Druck, Neigung, t. */
  recognizeStrokes(strokes: Float32Array[]): Promise<InkResult>;
  ocrImage(bytes: Uint8Array): Promise<OcrResult>;
  /** Hintergrund-Erkennung eines Blatts für die Suche (nur Geändertes). */
  recognizePage(pageId: string): Promise<PageRecognition>;
}

export const UNAVAILABLE = "Erkennung ist nur in der Windows-App verfügbar";

const tauri: Recognition = {
  status: () => invoke("recognition_status"),
  recognizeStrokes: (strokes) => invoke("recognize_strokes", { strokes: strokes.map((p) => ({ points: Array.from(p) })) }),
  ocrImage: (bytes) => invoke("ocr_image", { bytes: Array.from(bytes) }),
  recognizePage: (pageId) => invoke("recognize_page", { pageId }),
};

const demo: Recognition = {
  status: async () => ({ ink: false, ocr: false, ocrLanguage: null }),
  recognizeStrokes: async () => { throw new Error(UNAVAILABLE); },
  ocrImage: async () => { throw new Error(UNAVAILABLE); },
  recognizePage: async () => ({ inkUpdated: false, images: 0, unavailable: true }),
};

export const recognition: Recognition = inTauri ? tauri : demo;

export function dataUrlBytes(src: string): Uint8Array | null {
  const m = /^data:image\/[a-z+]+;base64,(.*)$/i.exec(src);
  if (!m) return null;
  const bin = atob(m[1]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
