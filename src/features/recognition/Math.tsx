import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

/** KaTeX-Anzeige; Fehler werden rot im Text markiert statt zu werfen. */
export function MathView({ latex, display = true, className }: { latex: string; display?: boolean; className?: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex || "\\square", { displayMode: display, throwOnError: false, strict: "ignore", trust: false, output: "htmlAndMathml" });
    } catch {
      return "";
    }
  }, [latex, display]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function latexError(latex: string): string | null {
  try {
    katex.renderToString(latex, { throwOnError: true, strict: "ignore" });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message.replace(/^KaTeX parse error: /, "") : String(e);
  }
}
