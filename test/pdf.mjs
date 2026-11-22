// PDF text-layer test (Node): page 1 of test/pdf/sample.pdf carries text and must come out without OCR.
// Pages 2–3 are scans; rendering them needs a canvas, which the browser test covers.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPdf, brokenShare } from "../src/pdf.js";

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
// Text layers whose Thai glyphs map to the wrong characters (seen in real PDFs) vs clean Thai text.
const garbled = ["ออกแบบสถาปัตยกรรมและพ=ฒนา backend / API ของระบบ Conversational AI ด้<ย Go, Python และ NestJS",
  "DXC Technology (โปรเจกต์ใหZเครุ(อ SCG), กรุงเทพฯ 2567 – 2568"];
const clean = ["ใบแจ้งหนี้ เลขที่ INV-2569/0158 ค่าบริการ 12,500.00 บาท ภาษีมูลค่าเพิ่ม 7% (ก/ข) \"ทดสอบ\" ข้อ 1.2–1.3",
  "พัฒนาระบบ AI ด้วย Go, Python และ NestJS ให้ลูกค้าในเครือ SCG กรุงเทพฯ ตั้งแต่ ม.ค. 2568 – ปัจจุบัน"];
const shareOk = garbled.every((t) => brokenShare(t) > 0.01) && clean.every((t) => brokenShare(t) === 0);
ok = ok && shareOk;
console.log(`${shareOk ? "PASS" : "FAIL"}  brokenShare: garbled ${garbled.map((t) => brokenShare(t).toFixed(2))} · clean ${clean.map((t) => brokenShare(t).toFixed(2))}`);
process.exit(ok ? 0 : 1);
