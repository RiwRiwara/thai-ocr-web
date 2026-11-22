// Parity test: the JS port must give exactly the text that the reference Python runtime
// (OpenThai 2.1 OCR Text, runtime/line_engine.py v2.1.4, ONNX Runtime backend) gave for every page in test/pages.
// The reference outputs are stored in test/golden/*.json. Runs onnxruntime-web's WASM build in Node, the same
// engine the browser uses.
//
//   npm test                 all pages
//   npm test -- 02_table     pages whose name contains "02_table"
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import * as ort from "onnxruntime-web/wasm";
import { LineOCR } from "../src/index.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const only = process.argv[2] || "";
const require = createRequire(import.meta.url);

// The vendored OpenCV.js is built for the web; in Node its loader expects CommonJS globals.
globalThis.require ??= require;
globalThis.__dirname ??= path.join(root, "vendor", "opencv");
globalThis.__filename ??= path.join(root, "vendor", "opencv", "opencv-ocr.mjs");
const cv = await (await import("../vendor/opencv/opencv-ocr.mjs")).default;
const ClipperLib = require("clipper-lib");
ort.env.wasm.numThreads = 1;

function cer(a, b) {
  a = [...a]; b = [...b];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return b.length ? prev[b.length] / b.length : a.length ? 1 : 0;
}

const ocr = await LineOCR.create({
  ort, cv, ClipperLib,
  loadFile: async (n) => new Uint8Array(fs.readFileSync(path.join(root, "models", n))),
});

const pages = fs.readdirSync(path.join(root, "test", "pages")).filter((f) => f.endsWith(".png") && f.includes(only)).sort();
let same = 0, worstBox = 0;
for (const f of pages) {
  const png = PNG.sync.read(fs.readFileSync(path.join(root, "test", "pages", f)));
  const t = performance.now();
  const r = await ocr.read({ data: png.data, width: png.width, height: png.height });
  const ms = performance.now() - t;
  const g = JSON.parse(fs.readFileSync(path.join(root, "test", "golden", f.replace(/\.png$/, ".json")), "utf8"));
  const ok = r.text === g.text && r.lines.length === g.lines.length && r.rotation === g.rotation;
  let box = 0;
  if (r.lines.length === g.lines.length) {
    r.lines.forEach((l, i) => l.box.forEach((p, k) => p.forEach((v, d) => { box = Math.max(box, Math.abs(v - g.lines[i].box[k][d])); })));
  }
  worstBox = Math.max(worstBox, box);
  if (ok) same++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${f.padEnd(20)} ${ms.toFixed(0).padStart(5)} ms  lines ${r.lines.length}/${g.lines.length}` +
    `  rot ${r.rotation}  box Δ ${box.toFixed(1)} px` + (r.text === g.text ? "" : `  CER ${(100 * cer(r.text, g.text)).toFixed(2)}%`));
  if (r.text !== g.text) console.log(`  js: ${JSON.stringify(r.text)}\n  py: ${JSON.stringify(g.text)}`);
}
await ocr.dispose();
console.log(`\n${same}/${pages.length} pages identical to the Python runtime (largest box difference ${worstBox.toFixed(1)} px)`);
process.exit(same === pages.length && pages.length ? 0 : 1);
