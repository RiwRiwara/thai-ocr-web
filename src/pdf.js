// PDF input: read every page of a PDF with pdf.js (pdfjs-dist, an optional peer dependency).
//
// A page that already carries text (a PDF exported from Word, a web page saved as PDF) gives that text directly:
// exact and instant. A page without text (a scan, a photo) is rendered to an image and read with OCR.
//
//   import { readPdf } from "thai-ocr-web/pdf";
//   for await (const page of readPdf(file, { read: (image) => ocr.read(image), workerSrc })) {
//     console.log(page.pageNumber, page.source, page.text);
//   }
import { canonical } from "./thai-norm.js";
import { invalidShare } from "./line-ocr.js";

/**
 * @param {Blob|ArrayBuffer|Uint8Array} source  the PDF
 * @param {object} o
 * @param {(image: ImageData) => Promise<{text: string}>} o.read  OCR for one page image, e.g. (img) => ocr.read(img)
 * @param {string} [o.workerSrc]  URL of pdfjs-dist/build/pdf.worker.min.mjs (pdf.js needs its worker)
 * @param {object} [o.pdfjs]  a pdfjs-dist module, if you load it yourself; otherwise it is imported here
 * @param {object} [o.documentOptions]  passed to pdfjs.getDocument (cMapUrl, standardFontDataUrl, wasmUrl, …)
 * @param {boolean} [o.useTextLayer=true]  take a page's own text when it has some; false = OCR every page
 * @param {number} [o.minTextChars=20]  a page needs at least this many non-space characters to count as text
 * @param {number} [o.maxBrokenShare=0.01]  a text layer with more unmapped characters (NUL, U+FFFD — Thai marks
 *   drawn with font-specific glyphs often lose their Unicode) or broken Thai spelling than this share is not
 *   trusted, and the page is read with OCR instead
 * @param {number} [o.targetLongSide=2200]  render scanned pages at this many pixels on the long side (~190 dpi on A4)
 * @param {boolean} [o.renderTextPages=false]  also render pages that have a text layer (to show them); they still
 *   are not OCR'd
 * @param {(p: {pageNumber: number, pageCount: number}) => void} [o.onPage]  called before each page is processed
 * @param {number} [o.maxPages=Infinity]
 * @param {AbortSignal} [o.signal]
 * @yields {{pageNumber, pageCount, source: "text-layer"|"ocr", text, result?, image?, width, height}}
 */
export async function* readPdf(source, {
  read, workerSrc, pdfjs, documentOptions = {}, useTextLayer = true, minTextChars = 20, maxBrokenShare = 0.01,
  targetLongSide = 2200, maxPages = Infinity, renderTextPages = false, onPage, signal,
} = {}) {
  if (typeof read !== "function") throw new Error("thai-ocr-web/pdf: pass { read: (imageData) => ocr.read(imageData) }");
  const lib = pdfjs || (await import("pdfjs-dist"));
  if (workerSrc) lib.GlobalWorkerOptions.workerSrc = workerSrc;
  const data = source instanceof Uint8Array ? source
    : new Uint8Array(source instanceof ArrayBuffer ? source : await source.arrayBuffer());
  const task = lib.getDocument({ data, ...documentOptions });
  const doc = await task.promise;
  try {
    const pageCount = doc.numPages;
    for (let n = 1; n <= Math.min(pageCount, maxPages); n++) {
      if (signal?.aborted) return;
      onPage?.({ pageNumber: n, pageCount });
      const page = await doc.getPage(n);
      try {
        const base = page.getViewport({ scale: 1 });
        if (useTextLayer) {
          const text = textOf(await page.getTextContent());
          const chars = text.replace(/\s/g, "").length;
          if (chars >= minTextChars && brokenShare(text) <= maxBrokenShare) {
            const image = renderTextPages ? await render(page, base, targetLongSide) : undefined;
            yield { pageNumber: n, pageCount, source: "text-layer", text, image,
              width: image?.width ?? base.width, height: image?.height ?? base.height };
            continue;
          }
        }
        if (signal?.aborted) return;
        const image = await render(page, base, targetLongSide);
        const result = await read(image);
        yield { pageNumber: n, pageCount, source: "ocr", text: result.text, result, image, width: image.width, height: image.height };
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await task.destroy();
  }
}

/** Render one page to ImageData on white, about targetLongSide pixels on its long side. */
async function render(page, base, targetLongSide) {
  const scale = Math.min(4, targetLongSide / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const w = Math.round(viewport.width), h = Math.round(viewport.height);
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#ffffff"; // transparent PDF backgrounds read as white paper
  ctx.fillRect(0, 0, w, h);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return ctx.getImageData(0, 0, w, h);
}

/** Text of a pdf.js TextContent, one line per text line, Thai-normalised (PDFs often carry legacy code points). */
function textOf(content) {
  let out = "";
  for (const item of content.items) {
    if (typeof item.str !== "string") continue;
    out += item.str + (item.hasEOL ? "\n" : "");
  }
  return canonical(out);
}

/** Share of characters that show a broken text layer: unmapped glyphs, or Thai marks without a base letter. */
function brokenShare(text) {
  const chars = [...text.replace(/\s/g, "")];
  if (!chars.length) return 1;
  const unmapped = chars.filter((c) => c === "\u0000" || c === "\uFFFD" || (c >= "\uE000" && c <= "\uF8FF")).length;
  return Math.max(unmapped / chars.length, invalidShare(text));
}

/** True for a PDF file (by type, name or the %PDF magic bytes). */
export async function isPdf(file) {
  if (file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "")) return true;
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...head) === "%PDF-";
}
