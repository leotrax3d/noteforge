import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface Rect { x: number; y: number; w: number; h: number }

/** Ausschnitt aus einer Bildschirmaufnahme wählen. */
export function ScreenshotCrop({ shot, onCancel, onDone }: {
  shot: HTMLCanvasElement; onCancel: () => void; onDone: (crop: HTMLCanvasElement) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [url] = useState(() => shot.toDataURL("image/png"));
  const [sel, setSel] = useState<Rect | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCancel]);

  const pos = (e: React.PointerEvent) => {
    const r = imgRef.current!.getBoundingClientRect();
    return { x: Math.min(Math.max(0, e.clientX - r.left), r.width), y: Math.min(Math.max(0, e.clientY - r.top), r.height) };
  };

  const finish = (full: boolean) => {
    const img = imgRef.current!;
    const k = shot.width / img.clientWidth;
    const r = full || !sel || sel.w < 4 || sel.h < 4 ? { x: 0, y: 0, w: img.clientWidth, h: img.clientHeight } : sel;
    const c = document.createElement("canvas");
    c.width = Math.round(r.w * k);
    c.height = Math.round(r.h * k);
    c.getContext("2d")!.drawImage(shot, r.x * k, r.y * k, r.w * k, r.h * k, 0, 0, c.width, c.height);
    onDone(c);
  };

  return (
    <div role="dialog" aria-label="Screenshot-Ausschnitt wählen" className="fixed inset-0 z-50 flex flex-col bg-black/80 p-4">
      <div className="mb-3 flex items-center gap-2 text-white">
        <p className="flex-1 text-sm">Ziehe einen Rahmen um den gewünschten Ausschnitt.</p>
        <Button variant="secondary" className="h-11" onClick={onCancel}>Abbrechen</Button>
        <Button variant="secondary" className="h-11" onClick={() => finish(true)}>Ganzes Bild</Button>
        <Button className="h-11" disabled={!sel || sel.w < 4} onClick={() => finish(false)}>Ausschnitt einfügen</Button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <div className="relative touch-none select-none"
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            start.current = pos(e);
            setSel({ ...start.current, w: 0, h: 0 });
          }}
          onPointerMove={(e) => {
            const s = start.current;
            if (!s) return;
            const p = pos(e);
            setSel({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
          }}
          onPointerUp={() => (start.current = null)}>
          <img ref={imgRef} src={url} alt="Bildschirmaufnahme" draggable={false} className="max-h-[calc(100vh-120px)] max-w-full" />
          {sel && (
            <div className="pointer-events-none absolute border-2 border-white" data-testid="crop-rect"
              style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h, boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)" }} />
          )}
        </div>
      </div>
    </div>
  );
}
