/** Rich-Text auf erlaubte Tags/Attribute beschränken (gespeichertes/synchronisiertes HTML). */
const TAGS = new Set([
  "B", "STRONG", "I", "EM", "U", "S", "H1", "H2", "H3", "P", "DIV", "BR", "UL", "OL", "LI", "SPAN", "FONT",
  "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "SUB", "SUP", "STRIKE", "BLOCKQUOTE", "HR",
]);
const ALIGN = /^(left|center|right|justify|start|end)$/i;

/** Erlaubte CSS-Eigenschaften: Text-/Markerfarbe, Ausrichtung. */
function cleanStyle(style: string): string {
  const out: string[] = [];
  for (const decl of style.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const k = decl.slice(0, i).trim().toLowerCase(), v = decl.slice(i + 1).trim();
    if ((k === "color" || k === "background-color") && COLOR.test(v)) out.push(`${k}: ${v}`);
    else if (k === "text-align" && ALIGN.test(v)) out.push(`${k}: ${v}`);
  }
  return out.join("; ");
}
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i;

export function sanitizeHtml(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (!TAGS.has(child.tagName)) {
        // Unbekannte Tags: Inhalt als Text behalten
        child.replaceWith(doc.createTextNode(child.textContent ?? ""));
        continue;
      }
      for (const a of [...child.attributes]) {
        if (a.name === "style") {
          const st = cleanStyle(a.value);
          if (st) child.setAttribute("style", st);
          else child.removeAttribute("style");
          continue;
        }
        const keep =
          (a.name === "color" && COLOR.test(a.value)) ||
          (a.name === "size" && child.tagName === "FONT" && /^[1-7]$/.test(a.value)) ||
          (a.name === "align" && ALIGN.test(a.value));
        if (!keep) child.removeAttribute(a.name);
      }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

export const isBlankHtml = (html: string) => !html.replace(/<br\s*\/?>|<\/?(p|div|span)[^>]*>|&nbsp;|\s/gi, "");

/**
 * Anzeige: `[[Titel]]` → anklickbarer Seitenlink. Nur für die Darstellung; gespeichert
 * wird weiterhin der Klartext (der Sanitizer macht aus <a> wieder Text mit Klammern).
 */
export function linkifyHtml(html: string): string {
  if (!html.includes("[[")) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n as Text).data.includes("[[")) nodes.push(n as Text);
  const re = /\[\[([^[\]\n]{1,120})\]\]/g;
  for (const t of nodes) {
    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const m of t.data.matchAll(re)) {
      const title = m[1].trim();
      if (!title) continue;
      frag.append(t.data.slice(last, m.index));
      const a = doc.createElement("a");
      a.className = "nf-link";
      a.setAttribute("data-link", title);
      a.setAttribute("href", "#");
      a.setAttribute("title", `Blatt „${title}“ öffnen`);
      const open = doc.createElement("span"), close = doc.createElement("span");
      open.className = close.className = "nf-br";
      open.textContent = "[[";
      close.textContent = "]]";
      a.append(open, m[1], close);
      frag.append(a);
      last = m.index! + m[0].length;
    }
    if (last === 0) continue;
    frag.append(t.data.slice(last));
    t.replaceWith(frag);
  }
  return doc.body.innerHTML;
}
