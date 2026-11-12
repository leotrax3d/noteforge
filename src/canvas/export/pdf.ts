// Minimaler PDF-1.4-Writer: je Seite ein JPEG über die volle Fläche (DCTDecode).

export interface PdfImagePage {
  /** JPEG-Bytes. */
  jpeg: Uint8Array;
  /** Pixelmaße des Bildes. */
  px: { w: number; h: number };
  /** Seitengröße in Millimetern. */
  mm: { w: number; h: number };
}

const PT_PER_MM = 72 / 25.4;
const enc = new TextEncoder();

/** PDF-Textstring als UTF-16BE-Hex (Umlaute im Titel). */
export function pdfText(s: string): string {
  let hex = "FEFF";
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  return `<${hex}>`;
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

export function buildPdf(pages: PdfImagePage[], meta: { title?: string } = {}): Uint8Array {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (b: Uint8Array | string) => {
    const u = typeof b === "string" ? enc.encode(b) : b;
    chunks.push(u);
    size += u.length;
  };
  // Objekt-Nummern: 1 Katalog, 2 Seitenbaum, 3 Info, dann je Seite: Seite, Inhalt, Bild
  const obj = (n: number, body: () => void) => {
    offsets[n] = size;
    push(`${n} 0 obj\n`);
    body();
    push("\nendobj\n");
  };
  const n = pages.length;
  const pageObj = (i: number) => 4 + i * 3;

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] >>`));
  obj(3, () => push(`<< /Producer ${pdfText("Noteforge")}${meta.title ? ` /Title ${pdfText(meta.title)}` : ""} >>`));
  pages.forEach((p, i) => {
    const W = p.mm.w * PT_PER_MM, H = p.mm.h * PT_PER_MM;
    const [po, co, io] = [pageObj(i), pageObj(i) + 1, pageObj(i) + 2];
    obj(po, () => push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(W)} ${fmt(H)}] ` +
      `/Resources << /XObject << /Im0 ${io} 0 R >> >> /Contents ${co} 0 R >>`,
    ));
    const content = `q ${fmt(W)} 0 0 ${fmt(H)} 0 0 cm /Im0 Do Q`;
    obj(co, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(io, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.px.w} /Height ${p.px.h} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg);
      push("\nendstream");
    });
  });
  const total = 4 + n * 3;
  const xref = size;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  push(x);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
