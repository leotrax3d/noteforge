import { useEffect, useRef, useState } from "react";
import { ArrowLeft, FileText, Search, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { api } from "@/lib/api";
import type { SearchHit } from "@/lib/types";
import { useNav } from "@/store/nav";
import { Highlight } from "./Highlight";

/** Volltextsuche über alle Fächer (SQLite FTS5). */
export function SearchPage({ query: initial = "" }: { query?: string }) {
  const go = useNav((s) => s.go);
  const back = useNav((s) => s.back);
  const [q, setQ] = useState(initial);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const n = ++seq.current;
    if (!q.trim()) {
      setHits(null);
      return;
    }
    const t = window.setTimeout(() => {
      api.search(q, 60).then(
        (h) => n === seq.current && (setHits(h), setError(null)),
        (e) => n === seq.current && setError(String(e)),
      );
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-2 py-1">
        <Button variant="ghost" size="icon" aria-label="Zurück" onClick={() => go(back ?? { view: "home" })}>
          <ArrowLeft />
        </Button>
        <div className="relative mr-auto max-w-2xl flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            type="search"
            aria-label="Suchbegriff"
            placeholder="In allen Blättern suchen …"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hits?.[0]) open(hits[0]);
              if (e.key === "Escape") go(back ?? { view: "home" });
            }}
            className="h-11 pl-10 text-base"
          />
        </div>
        <Button variant="ghost" onClick={() => go({ view: "tags" })}><Tags /> Tags</Button>
        <ThemeToggle />
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl">
          {error && <p className="text-destructive">{error}</p>}
          {hits && hits.length === 0 && <p className="text-muted-foreground">Keine Treffer für „{q}“.</p>}
          {hits && hits.length > 0 && (
            <>
              <p className="mb-2 text-sm text-muted-foreground" role="status">{hits.length === 1 ? "1 Treffer" : `${hits.length} Treffer`}</p>
              <ul className="flex flex-col gap-1" aria-label="Suchergebnisse">
                {hits.map((h) => (
                  <li key={h.pageId}>
                    <button type="button" onClick={() => open(h)}
                      className="flex min-h-11 w-full items-start gap-3 rounded-md border bg-card p-3 text-left hover:bg-accent">
                      <FileText className="mt-0.5 size-5 shrink-0" style={{ color: h.subjectColor }} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{h.title || "Unbenanntes Blatt"}</span>
                        <span className="block text-xs text-muted-foreground">{h.subjectName} · {h.sectionName}</span>
                        {h.snippet && <span className="mt-1 block text-sm"><Highlight text={h.snippet} /></span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </main>
    </div>
  );

  function open(h: SearchHit) {
    go({ view: "subject", subjectId: h.subjectId, pageId: h.pageId });
  }
}
