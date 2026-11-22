import type { ConfigOverrides, LineOCR } from "./index.js";
export * from "./index.js";

export declare const MODEL_FILES: string[];
/** True on iPhone / iPad, where createThaiOCR defaults to one WASM thread. */
export declare function isAppleMobile(): boolean;

export interface BrowserOptions {
  /** URL of the folder that holds the model files. Default "models/". */
  modelBaseUrl?: string;
  /** "webgpu" falls back to WASM when the device has no WebGPU. Default "wasm". */
  backend?: "webgpu" | "wasm";
  /** WASM threads, used only when the page is cross-origin isolated. Default min(4, cores). */
  threads?: number;
  /** Cache API bucket for the model files; false to skip caching. */
  cacheName?: string | false;
  overrides?: ConfigOverrides;
  /** JSON listing parts of onnxruntime-web's .wasm, for hosts with a per-file size limit (see scripts/split-large-assets.mjs). */
  wasmManifestUrl?: string;
}

export declare function createThaiOCR(options?: BrowserOptions): Promise<LineOCR & { backend: "webgpu" | "wasm" }>;
