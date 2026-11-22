// After `npm run build`: copy dist/ to hf-space/ and add the Space's README (its config), ready for
//   hf upload <user>/thai-ocr-web hf-space . --repo-type space
// The README's `models:` entry lists this Space on the model's page; `custom_headers` makes the page cross-origin
// isolated, so WASM can use threads (Hugging Face static Spaces allow only these three headers).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist"), out = path.join(root, "hf-space");
if (!fs.existsSync(path.join(dist, "index.html"))) throw new Error("run `npm run build` first");
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(dist, out, { recursive: true });
for (const f of ["_headers"]) fs.rmSync(path.join(out, f), { force: true }); // Cloudflare-only

const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
fs.writeFileSync(path.join(out, "README.md"), `---
title: Thai OCR in your browser
emoji: 📄
colorFrom: gray
colorTo: blue
sdk: static
app_file: index.html
pinned: true
license: apache-2.0
short_description: Thai + English OCR running in your browser (WebGPU/WASM)
models:
  - iapp/OpenThai2.1-OCR-Text-20261118
tags:
  - ocr
  - thai
  - webgpu
  - wasm
  - onnxruntime-web
  - javascript
custom_headers:
  cross-origin-embedder-policy: require-corp
  cross-origin-opener-policy: same-origin
  cross-origin-resource-policy: cross-origin
---

# Thai OCR in your browser

Read Thai and English text from images and PDFs **on your own device**, with WebGPU or WebAssembly. Nothing is
uploaded: the page downloads the models once and runs them locally.

This Space runs [thai-ocr-web](https://github.com/RiwRiwara/thai-ocr-web) v${version}, a JavaScript port of
[OpenThai 2.1 OCR Text](https://huggingface.co/iapp/OpenThai2.1-OCR-Text-20261118) by iApp Technology. The whole
reference runtime (\`line_engine.py\` v2.1.4) is ported, and the output is identical to it, character for character,
on every test page.

- Page orientation, deskew, column-aware reading order, loopless fonts, floating tone marks
- PDFs: the page's own text where it has a usable text layer, OCR for scanned pages
- Use it in your app: \`npm install thai-ocr-web onnxruntime-web\` ([npm](https://www.npmjs.com/package/thai-ocr-web))

Also at <https://thai-ocr-web.pages.dev>. Unofficial port, not affiliated with iApp Technology. Models: Apache-2.0.
`);
const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((a, e) =>
  a + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`hf-space/ ready (${(size(out) / 1e6).toFixed(1)} MB). Upload with:\n  hf upload <user>/thai-ocr-web hf-space . --repo-type space`);
