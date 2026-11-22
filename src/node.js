// Node entry: wires up ONNX Runtime (onnxruntime-node when installed, else onnxruntime-web's WASM build), the
// vendored OpenCV.js and clipper-lib, and reads the model files from this package's models/ folder.
//
//   import { createThaiOCR, readImageFile, readPdfFile } from "thai-ocr-web/node";
//   const ocr = await createThaiOCR();
//   const { text } = await ocr.read(await readImageFile("scan.png"));
//   for await (const page of readPdfFile(ocr, "doc.pdf")) console.log(page.pageNumber, page.text);
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LineOCR } from "./line-ocr.js";
import { readPdf } from "./pdf.js";

const require = createRequire(import.meta.url);
const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
/** Folder holding the OpenThai 2.1 OCR Text model files shipped with this package. */
export const MODEL_DIR = path.join(pkgRoot, "models");

let cvReady;
function loadOpenCV() {
  // The vendored OpenCV.js is an Emscripten web build; in Node its loader looks for CommonJS globals.
  globalThis.require ??= require;
  globalThis.__dirname ??= path.join(pkgRoot, "vendor", "opencv");
  globalThis.__filename ??= path.join(pkgRoot, "vendor", "opencv", "opencv-ocr.mjs");
  return (cvReady ??= import("../vendor/opencv/opencv-ocr.mjs").then((m) => m.default()));
}

/**
 * @param {object} [o]
 * @param {string} [o.modelDir]  folder with the model files (default: the package's own models/)
 * @param {number} [o.threads]  CPU threads for ONNX Runtime (default: number of cores, at most 8)
 * @param {object} [o.ort]  an ONNX Runtime module to use instead of onnxruntime-node / onnxruntime-web
 * @param {object} [o.overrides]  runtime config overrides, as for the Python runtime
 * @returns {Promise<LineOCR & { backend: "onnxruntime-node" | "onnxruntime-web (wasm)" }>}
 */
export async function createThaiOCR({ modelDir = MODEL_DIR, threads, ort, overrides = {} } = {}) {
  threads ??= Math.min(8, os.availableParallelism?.() ?? os.cpus().length);
  let runtime = ort, backend = "custom", executionProviders, sessionOptions = {};
  if (!runtime) {
    try {
      runtime = await import("onnxruntime-node");
      backend = "onnxruntime-node";
      executionProviders = ["cpu"];
      sessionOptions = { intraOpNumThreads: threads };
    } catch {
      // No native runtime installed: the WASM build works in Node too, on one thread.
      runtime = await import("onnxruntime-web/wasm");
      runtime.env.wasm.numThreads = 1;
      backend = "onnxruntime-web (wasm)";
    }
  }
  const [cv, ClipperLib] = [await loadOpenCV(), require("clipper-lib")];
  const ocr = await LineOCR.create({
    ort: runtime, cv, ClipperLib, overrides, executionProviders, sessionOptions,
    loadFile: async (name) => new Uint8Array(await fs.promises.readFile(path.join(modelDir, name))),
  });
  ocr.backend = backend;
  return ocr;
}

/**
 * Decode a PNG or JPEG file (or its bytes) into RGBA pixels for ocr.read(). Other formats (WebP, TIFF, HEIC…)
 * are decoded with `sharp` when it is installed.
 * @param {string | Uint8Array} file
 * @returns {Promise<{ data: Uint8Array, width: number, height: number }>}
 */
export async function readImageFile(file) {
  const bytes = typeof file === "string" ? await fs.promises.readFile(file) : Buffer.from(file);
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const { PNG } = require("pngjs");
    const png = PNG.sync.read(bytes);
    return { data: png.data, width: png.width, height: png.height };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const jpeg = require("jpeg-js");
    const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
    return { data: img.data, width: img.width, height: img.height };
  }
  let sharp;
  try { sharp = (await import("sharp")).default; } catch {
    throw new Error(`thai-ocr-web: ${typeof file === "string" ? file : "this image"} is not PNG or JPEG; install \`sharp\` to read other formats`);
  }
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Read every page of a PDF: a page's own text where it has a usable text layer, OCR for scanned pages.
 * Needs `pdfjs-dist`, and `@napi-rs/canvas` to render scanned pages.
 * @param {LineOCR} ocr  from createThaiOCR()
 * @param {string | Uint8Array} file
 * @param {object} [options]  readPdf options (useTextLayer, maxPages, onPage, targetLongSide, …)
 */
export async function* readPdfFile(ocr, file, options = {}) {
  let pdfjs;
  try { pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"); } catch {
    throw new Error("thai-ocr-web: reading PDFs needs pdfjs-dist (npm install pdfjs-dist)");
  }
  const dist = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const dir = (d) => pathToFileURL(path.join(dist, d) + path.sep).href;
  const data = typeof file === "string" ? new Uint8Array(await fs.promises.readFile(file)) : file;
  let napi;
  yield* readPdf(data, {
    pdfjs,
    read: (image) => ocr.read(image),
    createCanvas: async (w, h) => {
      try { napi ??= await import("@napi-rs/canvas"); } catch {
        throw new Error("thai-ocr-web: this PDF has scanned pages; rendering them in Node needs @napi-rs/canvas (npm install @napi-rs/canvas)");
      }
      return napi.createCanvas(w, h);
    },
    ...options,
    documentOptions: {
      cMapUrl: dir("cmaps"), cMapPacked: true, standardFontDataUrl: dir("standard_fonts"), wasmUrl: dir("wasm"),
      verbosity: 0, ...options.documentOptions,
    },
  });
}

export { LineOCR };
