// Eigener Farbwähler (Fläche für Sättigung/Helligkeit, Farbton-Regler, Hex) – ohne den alten Windows-Dialog.
import { useRef, type PointerEvent } from "react";

export function hexToHsv(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x3366ff;
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}

export function hsvToHex(h: number, s: number, v: number) {
  const f = (k: number) => { const x = (k + h / 60) % 6; return v - v * s * Math.max(0, Math.min(x, 4 - x, 1)); };
  return "#" + [f(5), f(3), f(1)].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
}

export function HsvPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [h, s, v] = hexToHsv(value);
  const box = useRef<HTMLDivElement>(null);
  const pick = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    onChange(hsvToHex(h, x, 1 - y));
  };
  return (
    <div className="grid gap-3" data-testid="hsv-picker">
      <div ref={box} role="slider" aria-label="Sättigung und Helligkeit" aria-valuenow={Math.round(s * 100)} tabIndex={0}
        className="relative h-36 cursor-crosshair touch-none rounded-lg"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h} 100% 50%))` }}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); pick(e); }}
        onPointerMove={(e) => e.buttons && pick(e)}>
        <span className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: value }} />
      </div>
      <input type="range" min={0} max={359} value={Math.round(h)} aria-label="Farbton" className="hue w-full"
        onChange={(e) => onChange(hsvToHex(+e.target.value, s || 0.7, v || 0.8))} />
      <div className="flex items-center gap-2">
        <span className="size-9 shrink-0 rounded-md border" style={{ background: value }} />
        <input aria-label="Hex-Farbe" className="h-11 w-full rounded-md border bg-background px-3 font-mono" defaultValue={value} key={value}
          onBlur={(e) => /^#?[0-9a-f]{6}$/i.test(e.target.value.trim()) && onChange("#" + e.target.value.trim().replace("#", "").toLowerCase())} />
      </div>
    </div>
  );
}
