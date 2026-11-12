import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import type { Page } from "@/lib/types";

const MM = 96 / 25.4; // CSS-Pixel pro Millimeter

function backgroundStyle(page: Page): React.CSSProperties {
  const s = page.bgSpacingMm * MM;
  const line = "var(--canvas-grid)";
  switch (page.background) {
    case "grid":
      return {
        backgroundImage: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`,
        backgroundSize: `${s}px ${s}px`,
      };
    case "lines":
      return { backgroundImage: `linear-gradient(${line} 1px, transparent 1px)`, backgroundSize: `100% ${s}px` };
    case "dots":
      return { backgroundImage: `radial-gradient(${line} 1.2px, transparent 1.2px)`, backgroundSize: `${s}px ${s}px` };
    default:
      return {};
  }
}

/** Platzhalter bis zum Canvas-Kern (Phase 2): Titel + Hintergrundmuster. */
export function CanvasPlaceholder({ page, onRename }: { page: Page; onRename: (title: string) => void }) {
  const [title, setTitle] = useState(page.title);
  useEffect(() => setTitle(page.title), [page.id, page.title]);
  const commit = () => title.trim() !== page.title && onRename(title);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-3">
        <Input
          aria-label="Blatttitel"
          placeholder="Unbenanntes Blatt"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          className="h-11 border-transparent bg-transparent px-0 text-2xl font-semibold shadow-none focus-visible:border-input md:text-2xl dark:bg-transparent"
        />
        <p className="text-xs text-muted-foreground">
          Erstellt {new Date(page.createdAt).toLocaleString("de-DE")} · Geändert {new Date(page.updatedAt).toLocaleString("de-DE")}
        </p>
      </div>
      <div
        data-testid="canvas-placeholder"
        className="relative flex-1 touch-none bg-[var(--canvas-page)]"
        style={backgroundStyle(page)}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="rounded-md bg-background/80 px-4 py-2 text-sm text-muted-foreground shadow-sm">
            Zeichenfläche folgt in Phase 2
          </p>
        </div>
      </div>
    </div>
  );
}
