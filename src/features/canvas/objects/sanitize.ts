/** Rich-Text auf erlaubte Tags/Attribute beschränken (gespeichertes/synchronisiertes HTML). */
const TAGS = new Set([
  "B", "STRONG", "I", "EM", "U", "S", "H1", "H2", "H3", "P", "DIV", "BR", "UL", "OL", "LI", "SPAN", "FONT",
  "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "SUB", "SUP",
]);
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
        const keep =
          (a.name === "color" && COLOR.test(a.value)) ||
          (a.name === "style" && /^\s*color\s*:\s*[^;]+;?\s*$/i.test(a.value) && COLOR.test(a.value.split(":")[1].replace(";", "").trim()));
        if (!keep) child.removeAttribute(a.name);
      }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

export const isBlankHtml = (html: string) => !html.replace(/<br\s*\/?>|<\/?(p|div|span)[^>]*>|&nbsp;|\s/gi, "");
