// Einstellungen → Darstellung: Glas-Effekt, Transparenz/Blur mit Live-Vorschau, Hintergrund, Fenstermaterial.
import { useRef } from "react";
import { ImagePlus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/common/Switch";
import { BACKGROUNDS, effective, glassActive, saveGlassImage, useGlass, type Material, type SaverBlur } from "@/lib/glass";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme/theme-provider";

function Radio<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
        {options.map(([v, l]) => (
          <Button key={v} role="radio" aria-checked={value === v} variant={value === v ? "secondary" : "outline"}
            className={cn("h-11 flex-1", value === v && "ring-2 ring-ring")} onClick={() => onChange(v)}>{l}</Button>
        ))}
      </div>
    </div>
  );
}

/** Kleine Vorschau: Kachel über dem gewählten Hintergrund mit den aktuellen Glas-Werten. */
export function GlassPreview({ className }: { className?: string }) {
  const g = useGlass();
  const bg = BACKGROUNDS.find((b) => b.id === g.background)?.css ?? BACKGROUNDS[0].css;
  return (
    <div data-testid="glass-preview" className={cn("relative h-32 overflow-hidden rounded-2xl", className)} aria-hidden>
      <div className="absolute -inset-6" style={{ background: bg, filter: "blur(24px)" }} />
      <div className="absolute inset-0" style={{ background: "var(--glass-dim)" }} />
      <div className="glass-surface absolute top-4 left-4 flex h-24 w-40 flex-col justify-between p-3 text-foreground" style={{ borderRadius: "var(--radius-glass)" }}>
        <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground"><Sparkles className="size-4" /></span>
        <span className="text-sm font-medium">Mathe <span className="text-muted-foreground">· 3 Blätter</span></span>
      </div>
      <div className="glass-surface absolute top-10 right-4 h-16 w-28 p-3 text-xs text-muted-foreground" style={{ borderRadius: 18 }}>Klassenarbeit in 4 Tagen</div>
    </div>
  );
}

export function GlassSection() {
  const g = useGlass();
  const { resolved } = useTheme();
  const file = useRef<HTMLInputElement>(null);
  const eff = effective(g, resolved);
  return (
    <section className="grid gap-3 rounded-lg border p-3" aria-labelledby="glass-h">
      <h3 id="glass-h" className="font-medium">Glas</h3>
      <Switch id="glass-on" label={`Glas-Effekt (${resolved === "dark" ? "Glas dunkel" : "Glas hell"})`} checked={g.enabled} onChange={(enabled) => g.set({ enabled })} />
      {g.enabled && g.systemBlocked && (
        <p role="status" className="text-sm text-muted-foreground">Windows: Transparenzeffekte sind aus oder der Kontrastmodus ist aktiv – Glas ist deshalb abgeschaltet.</p>
      )}
      {g.enabled && (
        <>
          <GlassPreview />
          <div className="grid gap-1.5">
            <Label htmlFor="glass-op">Transparenz <span className="text-muted-foreground">({Math.round((1 - g.opacity) * 100)} %{eff.opacity > g.opacity ? `, für Lesbarkeit auf ${Math.round((1 - eff.opacity) * 100)} % begrenzt` : ""})</span></Label>
            <input id="glass-op" type="range" min={5} max={80} value={Math.round((1 - g.opacity) * 100)} onChange={(e) => g.set({ opacity: 1 - Number(e.target.value) / 100 })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="glass-blur">Blur-Stärke <span className="text-muted-foreground">({g.blur} px)</span></Label>
            <input id="glass-blur" type="range" min={0} max={48} value={g.blur} onChange={(e) => g.set({ blur: Number(e.target.value) })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Hintergrund</Label>
            <div role="radiogroup" aria-label="Hintergrund" className="flex flex-wrap gap-2">
              <button type="button" role="radio" aria-checked={g.background === "none"} aria-label="Kein Hintergrund" title="Kein Hintergrund" onClick={() => g.set({ background: "none" })}
                className={cn("size-11 rounded-full border-2 bg-background", g.background === "none" && "ring-[3px] ring-primary ring-offset-2 ring-offset-background")} />
              {BACKGROUNDS.map((b) => (
                <button key={b.id} type="button" role="radio" aria-checked={g.background === b.id} aria-label={b.label} title={b.label} onClick={() => g.set({ background: b.id })}
                  className={cn("size-11 rounded-full", g.background === b.id && "ring-[3px] ring-primary ring-offset-2 ring-offset-background")} style={{ background: b.css }} />
              ))}
              <Button variant={g.background === "custom" ? "secondary" : "outline"} role="radio" aria-checked={g.background === "custom"}
                className={cn("h-11", g.background === "custom" && "ring-2 ring-ring")} onClick={() => file.current?.click()}><ImagePlus /> Eigenes Bild</Button>
              <input ref={file} type="file" accept="image/*" className="hidden" data-testid="glass-file"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void saveGlassImage(f).catch(console.error); e.target.value = ""; }} />
            </div>
          </div>
          <Switch id="glass-accent" label="Akzentfarbe aus dem Hintergrund" checked={g.autoAccent} onChange={(autoAccent) => g.set({ autoAccent })} />
          <Radio<Material> label="Fensterhintergrund" value={g.material} onChange={(material) => g.set({ material })}
            options={[["mica", "Mica"], ["acrylic", "Acrylic"], ["off", "Aus"]]} />
          <Radio<SaverBlur> label="Im Akku-Leistungsmodus" value={g.saverBlur} onChange={(saverBlur) => g.set({ saverBlur })}
            options={[["keep", "Blur behalten"], ["reduce", "Blur reduzieren"], ["off", "Kein Blur"]]} />
        </>
      )}
      <Switch id="reduce-motion" label="Animationen reduzieren" checked={g.reduceMotion} onChange={(reduceMotion) => g.set({ reduceMotion })} />
      {glassActive(g) && eff.blur === 0 && g.blur > 0 && <p className="text-sm text-muted-foreground">Gerade ohne Blur (Akkumodus oder nicht unterstützt) – dafür deckender.</p>}
    </section>
  );
}
