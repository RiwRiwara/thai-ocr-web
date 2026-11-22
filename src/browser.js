// Browser entry: wires up onnxruntime-web, the minimal OpenCV.js build and clipper-lib, loads the models
// (cached with the Cache API) and returns a ready LineOCR. Works on the main thread or in a Web Worker.
//
//   import { createThaiOCR } from "thai-ocr-web/browser";
//   const ocr = await createThaiOCR({ modelBaseUrl: "/models/", backend: "webgpu" });
//   const { text, lines } = await ocr.read(imageData);
import ClipperLib from "clipper-lib";
import loadOpenCV from "../vendor/opencv/opencv-ocr.mjs";
import { LineOCR } from "./line-ocr.js";

export const MODEL_FILES = ["det.yml", "config.json", "rec_dict.txt", "det.onnx", "rec.onnx", "rec2.onnx"];

/**
 * @param {object} [o]
 * @param {string} [o.modelBaseUrl]  URL of the folder that holds the model files (MODEL_FILES). Default "models/".
 * @param {"webgpu"|"wasm"} [o.backend]  "webgpu" falls back to WASM when the device has no WebGPU. Default "wasm".
 * @param {number} [o.threads]  WASM threads; only used when the page is cross-origin isolated. Default min(4, cores),
 *   or 1 on iOS / iPadOS, where multi-threaded onnxruntime-web fails to create sessions.
 * @param {string|false} [o.cacheName]  Cache API bucket for the model files; false to skip caching.
 * @param {object} [o.overrides]  runtime config overrides, e.g. { join: { paragraphs: true } }.
 * @param {string} [o.wasmManifestUrl]  For hosts with a per-file size limit (Cloudflare: 25 MiB): a JSON file,
 *   as written by scripts/split-large-assets.mjs, listing the parts of onnxruntime-web's .wasm. The parts are
 *   joined here and handed to onnxruntime-web. A missing manifest (404) is ignored.
 * @returns {Promise<LineOCR & { backend: "webgpu"|"wasm" }>}
 */
export async function createThaiOCR({
  modelBaseUrl = "models/",
  backend = "wasm",
  threads = isAppleMobile() ? 1 : Math.min(4, globalThis.navigator?.hardwareConcurrency || 1),
  cacheName = "thai-ocr-web-models-2.1.4",
  overrides = {},
  wasmManifestUrl,
} = {}) {
  // Only the chosen build is loaded: WASM ~15 MB (~4 MB gzip), WebGPU ~29 MB (~7 MB gzip).
  // Notes for Web Worker hosts (see demo/ocr.worker.js):
  // - onnxruntime-web starts its WASM threads from the chunk it was bundled into, and that chunk can import the
  //   worker's entry module, so the entry must not take over `onmessage` when self.name starts with "em-pthread";
  // - WebKit (every iOS browser) can evaluate a worker's entry module a second time when a chunk imports it, so
  //   install the message handler only once.
  const ort = backend === "webgpu" ? await import("onnxruntime-web/webgpu") : await import("onnxruntime-web/wasm");
  ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? threads : 1;
  const cv = await loadOpenCV();
  const base = new URL(modelBaseUrl, globalThis.location?.href).href;
  const cache = cacheName && globalThis.caches ? await caches.open(cacheName).catch(() => null) : null;
  const loadFile = async (name) => {
    const url = new URL(name, base).href;
    let res = cache && (await cache.match(url));
    if (!res) {
      res = await fetch(url);
      if (!res.ok) throw new Error(`thai-ocr-web: cannot load ${url} (${res.status})`);
      if (cache) await cache.put(url, res.clone());
    }
    return new Uint8Array(await res.arrayBuffer());
  };
  if (wasmManifestUrl) {
    const binary = await joinedWasm(new URL(wasmManifestUrl, globalThis.location?.href).href, backend, cache);
    if (binary) ort.env.wasm.wasmBinary = binary;
  }
  const make = (eps) => LineOCR.create({ ort, cv, ClipperLib, loadFile, executionProviders: eps, overrides });
  let ocr, used = backend;
  if (backend === "webgpu") {
    try {
      if (!globalThis.navigator?.gpu || !(await navigator.gpu.requestAdapter())) throw new Error("no WebGPU adapter");
      ocr = await make(["webgpu", "wasm"]);
    } catch {
      used = "wasm";
      ocr = await make(["wasm"]);
    }
  } else {
    ocr = await make(["wasm"]);
  }
  ocr.backend = used;
  return ocr;
}

/** iPhone / iPad (every iOS browser is WebKit; iPadOS reports itself as a Mac with touch). */
export function isAppleMobile() {
  const n = globalThis.navigator;
  if (!n) return false;
  return /iPhone|iPad|iPod/.test(n.userAgent) || (/Macintosh/.test(n.userAgent) && n.maxTouchPoints > 1);
}

async function joinedWasm(manifestUrl, backend, cache) {
  const res = await fetch(manifestUrl).catch(() => null);
  if (!res || !res.ok) return null;
  const entry = (await res.json())[backend];
  if (!entry) return null;
  const out = new Uint8Array(entry.size);
  let off = 0;
  for (const part of entry.parts) {
    const url = new URL(part, manifestUrl).href;
    let r = cache && (await cache.match(url));
    if (!r) {
      r = await fetch(url);
      if (!r.ok) throw new Error(`thai-ocr-web: cannot load ${url} (${r.status})`);
      if (cache) await cache.put(url, r.clone());
    }
    const b = new Uint8Array(await r.arrayBuffer());
    out.set(b, off);
    off += b.length;
  }
  if (off !== entry.size) throw new Error("thai-ocr-web: wasm parts do not add up");
  return out.buffer;
}

export { LineOCR };
