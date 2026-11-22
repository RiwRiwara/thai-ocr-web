// Before `vite` / `vite build`: copy the model files into demo/public/models, add coi-serviceworker, and collect
// the licences of everything the built site ships into demo/public/THIRD_PARTY_LICENSES.txt.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, "demo", "public");
fs.mkdirSync(path.join(pub, "models"), { recursive: true });
for (const f of fs.readdirSync(path.join(root, "models"))) {
  fs.copyFileSync(path.join(root, "models", f), path.join(pub, "models", f));
}

// sample pages for the demo's "try a sample" buttons
fs.mkdirSync(path.join(pub, "samples"), { recursive: true });
for (const f of fs.readdirSync(path.join(root, "test", "pages"))) {
  fs.copyFileSync(path.join(root, "test", "pages", f), path.join(pub, "samples", f));
}

// PDF input: pdf.js character maps (CJK / legacy encodings), the 14 standard fonts, and its image decoders (JBIG2,
// JPEG 2000 and colour profiles, as WebAssembly), served next to the page. A sample PDF for the demo button.
const pdfjsDir = path.join(root, "node_modules", "pdfjs-dist");
for (const [from, to, keep] of [["cmaps", "cmaps"], ["standard_fonts", "standard_fonts"],
  ["wasm", "wasm", (f) => /^(jbig2|openjpeg|qcms)/.test(f)]]) {
  fs.mkdirSync(path.join(pub, "pdfjs", to), { recursive: true });
  for (const f of fs.readdirSync(path.join(pdfjsDir, from))) {
    if (!keep || keep(f)) fs.copyFileSync(path.join(pdfjsDir, from, f), path.join(pub, "pdfjs", to, f));
  }
}
fs.copyFileSync(path.join(root, "test", "pdf", "sample.pdf"), path.join(pub, "samples", "sample.pdf"));

// GitHub Pages: service worker that adds the cross-origin isolation headers (see demo/index.html)
fs.copyFileSync(path.join(root, "node_modules", "coi-serviceworker", "coi-serviceworker.min.js"),
  path.join(pub, "coi-serviceworker.min.js"));

const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const pkgLicense = (name) => {
  const dir = path.join(root, "node_modules", name);
  const file = fs.readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
  return file ? fs.readFileSync(path.join(dir, file), "utf8") : `See https://www.npmjs.com/package/${name}`;
};
const section = (title, body) => `${"=".repeat(78)}\n${title}\n${"=".repeat(78)}\n\n${body.trim()}\n\n`;
const out =
  section("thai-ocr-web", read("NOTICE")) +
  section("OpenThai 2.1 OCR Text models (models/) — NOTICE", read("models", "NOTICE")) +
  section("onnxruntime-web", pkgLicense("onnxruntime-web")) +
  section("clipper-lib", pkgLicense("clipper-lib") +
    "\n\nThe Clipper library is distributed under the Boost Software License 1.0, Copyright Angus Johnson.") +
  section("coi-serviceworker", pkgLicense("coi-serviceworker")) +
  section("pdf.js (pdfjs-dist) — Mozilla Foundation, Apache License 2.0", "See the Apache License 2.0 at the end of this file.") +
  ["JBIG2", "PDFJS_JBIG2", "OPENJPEG", "PDFJS_OPENJPEG", "QCMS", "PDFJS_QCMS"].map((n) =>
    section(`pdf.js image decoders — LICENSE_${n}`, read("node_modules", "pdfjs-dist", "wasm", `LICENSE_${n}`))).join("") +
  section("OpenCV (vendor/opencv/opencv-ocr.mjs) and thai-ocr-web, OpenThai models: Apache License 2.0", read("LICENSE"));
fs.writeFileSync(path.join(pub, "THIRD_PARTY_LICENSES.txt"), out);
console.log("demo/public prepared (models, THIRD_PARTY_LICENSES.txt)");
