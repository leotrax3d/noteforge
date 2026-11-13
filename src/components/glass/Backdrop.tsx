// Weichgezeichneter, abgedunkelter Hintergrund hinter den Glasflächen (nur wenn „Glas“ aktiv).
import { useEffect, useState } from "react";
import { applyGlass, imageStops, loadGlassImage, useGlass } from "@/lib/glass";
import { useSetup } from "@/store/setup";

export function GlassBackdrop() {
  const { enabled, background, customAsset, autoAccent } = useGlass();
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || background !== "custom" || !customAsset) { setImg(null); return; }
    let alive = true;
    void loadGlassImage().then((u) => { if (alive) setImg(u); }).catch(() => setImg(null));
    return () => { alive = false; };
  }, [enabled, background, customAsset]);
  // Kontrast-Untergrenze und optional Akzentfarbe aus dem Hintergrund
  useEffect(() => {
    if (!enabled) return;
    if (img) {
      void imageStops(img).then(({ stops, accent }) => {
        useGlass.setState({ customStops: stops });
        applyGlass();
        if (autoAccent) useSetup.getState().set({ accent });
      }).catch(() => {});
    }
  }, [enabled, img, background, autoAccent]);
  if (!enabled) return null;
  if (!img) return null;
  const style = { background: `center / cover no-repeat url(${img})` };
  return <div className="nf-backdrop" aria-hidden data-testid="glass-backdrop"><div style={style} /></div>;
}
