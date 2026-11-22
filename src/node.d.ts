import type { ConfigOverrides, ImageDataLike, LineOCR } from "./index.js";
import type { PdfPage, ReadPdfOptions } from "./pdf.js";
export * from "./index.js";

/** Folder holding the model files shipped with the package. */
export declare const MODEL_DIR: string;

export interface NodeOptions {
  /** folder with the model files (default: the package's own models/) */
  modelDir?: string;
  /** CPU threads for ONNX Runtime (default: cores, at most 8) */
  threads?: number;
  /** an ONNX Runtime module to use instead of onnxruntime-node / onnxruntime-web */
  ort?: unknown;
  overrides?: ConfigOverrides;
}

/** onnxruntime-node when installed, else onnxruntime-web's WASM build (one thread). */
export declare function createThaiOCR(options?: NodeOptions): Promise<LineOCR & { backend: string }>;

/** Decode a PNG or JPEG (other formats with `sharp`, if installed) into RGBA pixels. */
export declare function readImageFile(file: string | Uint8Array): Promise<ImageDataLike>;

/** Read a PDF page by page (needs pdfjs-dist; scanned pages also need @napi-rs/canvas). */
export declare function readPdfFile(ocr: LineOCR, file: string | Uint8Array,
  options?: Omit<ReadPdfOptions, "read" | "pdfjs" | "workerSrc">): AsyncGenerator<PdfPage>;
