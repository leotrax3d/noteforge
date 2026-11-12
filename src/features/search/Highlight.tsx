/** Rendert einen Such-Ausschnitt; Treffer stehen zwischen \u0001 und \u0002. */
export function Highlight({ text }: { text: string }) {
  const parts = text.split(/(\u0001[^\u0002]*\u0002)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("\u0001") ? (
          <mark key={i} className="rounded-sm bg-yellow-300/70 px-0.5 text-inherit dark:bg-yellow-500/40">{p.slice(1, -1)}</mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
