// Turns OpenCV's UMD opencv.js into an ES module whose default export is a function returning a Promise of the
// ready cv object. OpenCV starts only when the function is first called, not on import (a module can be
// evaluated in places that never need it, e.g. onnxruntime-web's thread workers).
// (The UMD wrapper assigns an undeclared global `Module`, which throws in strict ES modules.)
//   node wrap.mjs <build>/bin/opencv.js ../opencv-ocr.mjs
import fs from "node:fs";

const [src, out] = process.argv.slice(2);
const s = fs.readFileSync(src, "utf8");
const startTag = "}(this, function () {\n";
const endTag = "\n  if (typeof Module === 'undefined')";
const start = s.indexOf(startTag);
const end = s.indexOf(endTag);
if (start < 0 || end < 0) throw new Error("unexpected opencv.js wrapper; update wrap.mjs");
const head =
  "// Minimal OpenCV.js 5.0.0 build for thai-ocr-web (core + imgproc whitelist; see vendor/opencv/build).\n" +
  "// OpenCV is licensed under the Apache License 2.0, Copyright the OpenCV team. Built from source with one\n" +
  "// line added to modules/js/src/core_bindings.cpp (an empty namespace declaration; see build.sh).\n";
fs.writeFileSync(out, head + s.slice(start + startTag.length, end) + "\nlet ready;\nexport default function loadOpenCV() { return (ready ??= cv({})); }\n");
console.log(`wrote ${out} (${(fs.statSync(out).size / 1e6).toFixed(2)} MB)`);
