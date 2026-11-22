// After `vite build`: Cloudflare Pages / Workers static assets accept files up to 25 MiB, and onnxruntime-web's
// WebGPU runtime (ort-wasm-simd-threaded.asyncify.wasm) is ~28.7 MB. Split any .wasm over the limit into parts
// and write dist/ort-wasm-manifest.json; createThaiOCR({ wasmManifestUrl }) joins the parts in the browser and
// hands the binary to onnxruntime-web, which then never requests the original file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "dist");
const LIMIT = 24 * 1024 * 1024; // below Cloudflare's 25 MiB, with room to spare
const manifest = {};

for (const f of fs.readdirSync(path.join(dist, "assets"))) {
  const file = path.join(dist, "assets", f);
  const size = fs.statSync(file).size;
  if (size <= LIMIT) continue;
  if (!f.endsWith(".wasm")) throw new Error(`${f} is ${size} bytes, over the host's per-file limit`);
  const buf = fs.readFileSync(file);
  const parts = [];
  for (let i = 0, off = 0; off < buf.length; i++, off += LIMIT) {
    const name = `${f}.part${i}`;
    fs.writeFileSync(path.join(dist, "assets", name), buf.subarray(off, off + LIMIT));
    parts.push(`assets/${name}`);
  }
  fs.rmSync(file);
  // key: the runtime build the file belongs to (onnxruntime-web/webgpu uses the asyncify build)
  manifest[f.includes(".asyncify") ? "webgpu" : f.includes(".jsep") ? "jsep" : "wasm"] = { parts, size };
  console.log(`split ${f} (${(size / 1e6).toFixed(1)} MB) into ${parts.length} parts`);
}

fs.writeFileSync(path.join(dist, "ort-wasm-manifest.json"), JSON.stringify(manifest, null, 2));
