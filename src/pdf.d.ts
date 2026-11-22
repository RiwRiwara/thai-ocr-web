import type { ImageDataLike, OcrResult } from "./index.js";

export interface PdfPage {
  pageNumber: number;
  pageCount: number;
  /** "text-layer": the page's own text; "ocr": rendered and read with OCR */
  source: "text-layer" | "ocr";
  text: string;
  /** present for OCR pages */
  result?: OcrResult;
  /** the rendered page, for OCR pages */
  image?: ImageData;
  width: number;
  height: number;
}

export interface ReadPdfOptions {
  /** OCR for one page image, e.g. (img) => ocr.read(img) */
  read(image: ImageDataLike): Promise<{ text: string } & Partial<OcrResult>>;
  /** URL of pdfjs-dist/build/pdf.worker.min.mjs */
  workerSrc?: string;
  /** a pdfjs-dist module, if you load it yourself */
  pdfjs?: unknown;
  /** passed to pdfjs.getDocument (cMapUrl, standardFontDataUrl, wasmUrl, …) */
  documentOptions?: Record<string, unknown>;
  /** take a page's own text when it has some (default true) */
  useTextLayer?: boolean;
  /** non-space characters a page needs to count as text (default 20) */
  minTextChars?: number;
  /** share of unmapped / broken characters above which a text layer is not trusted and the page is OCR'd (default 0.01) */
  maxBrokenShare?: number;
  /** also render text-layer pages (for display); they are still not OCR'd (default false) */
  renderTextPages?: boolean;
  /** called before each page is processed */
  onPage?: (p: { pageNumber: number; pageCount: number }) => void;
  /** pixels on the long side for rendering scanned pages (default 2200) */
  targetLongSide?: number;
  maxPages?: number;
  signal?: AbortSignal;
}

export declare function readPdf(source: Blob | ArrayBuffer | Uint8Array, options: ReadPdfOptions): AsyncGenerator<PdfPage>;
/** Share (0–1) of characters showing a broken text layer: unmapped glyphs, broken Thai mark order, symbols wedged between Thai letters. */
export declare function brokenShare(text: string): number;

export declare function isPdf(file: Blob & { name?: string }): Promise<boolean>;
