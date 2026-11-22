// PDF text-layer test (Node): page 1 of test/pdf/sample.pdf carries text and must come out without OCR.
// Pages 2–3 are scans; rendering them needs a canvas, which the browser test covers.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPdf } from "../src/pdf.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"); // the legacy build runs in Node
const data = new Uint8Array(fs.readFileSync(path.join(root, "test", "pdf", "sample.pdf")));

let ok = true;
const read = async () => { throw new Error("page 1 should not need OCR"); };
for await (const page of readPdf(data, { pdfjs, read, maxPages: 1, documentOptions: { verbosity: 0 } })) {
  const expect = ["ตัวอย่างไฟล์ PDF สำหรับทดสอบ thai-ocr-web", "This page already carries text"];
  const missing = expect.filter((s) => !page.text.includes(s));
  ok = page.source === "text-layer" && page.pageCount === 3 && missing.length === 0;
  console.log(`${ok ? "PASS" : "FAIL"}  sample.pdf page 1: ${page.source}, ${page.text.length} chars` +
    (missing.length ? `, missing: ${missing.join(" | ")}\n${page.text}` : ""));
}
// A text layer with unmapped Thai glyphs (NUL characters) must not be trusted: the page goes to OCR instead.
// In Node the OCR path stops at rendering (no canvas) — reaching it is the pass condition.
const broken = new Uint8Array(fs.readFileSync(path.join(root, "test", "pdf", "broken-text-layer.pdf")));
let brokenSource = "none";
try {
  for await (const page of readPdf(broken, { pdfjs, read, maxPages: 1, documentOptions: { verbosity: 0 } })) brokenSource = page.source;
} catch { brokenSource = "ocr"; }
const brokenOk = brokenSource === "ocr";
ok = ok && brokenOk;
console.log(`${brokenOk ? "PASS" : "FAIL"}  broken-text-layer.pdf page 1: ${brokenSource} (expected ocr)`);
process.exit(ok ? 0 : 1);
