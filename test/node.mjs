// thai-ocr-web/node: the same parity check as test/parity.mjs, through the Node entry (onnxruntime-node when
// installed), plus a scanned PDF page rendered with @napi-rs/canvas.
//   node test/node.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createThaiOCR, readImageFile, readPdfFile } from "../src/node.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ocr = await createThaiOCR();
console.log(`backend: ${ocr.backend}`);

const pages = fs.readdirSync(path.join(root, "test", "pages")).filter((f) => f.endsWith(".png")).sort();
let same = 0, total = 0;
for (const f of pages) {
  const t = performance.now();
  const r = await ocr.read(await readImageFile(path.join(root, "test", "pages", f)));
  const ms = performance.now() - t;
  const g = JSON.parse(fs.readFileSync(path.join(root, "test", "golden", f.replace(/\.png$/, ".json")), "utf8"));
  const ok = r.text === g.text && r.lines.length === g.lines.length && r.rotation === g.rotation;
  if (ok) same++;
  total += ms;
  console.log(`${ok ? "PASS" : "FAIL"}  ${f.padEnd(20)} ${ms.toFixed(0).padStart(5)} ms`);
  if (!ok) console.log(`  js: ${JSON.stringify(r.text)}\n  py: ${JSON.stringify(g.text)}`);
}
console.log(`${same}/${pages.length} identical · mean ${(total / pages.length).toFixed(0)} ms/page`);

// sample.pdf: page 1 has a text layer, page 2 is the 02_table scan
const got = [];
for await (const p of readPdfFile(ocr, path.join(root, "test", "pdf", "sample.pdf"), { maxPages: 2 })) got.push(p);
const pdfOk = got[0]?.source === "text-layer" && got[1]?.source === "ocr" && got[1].text.includes("รายการงบประมาณ");
console.log(`${pdfOk ? "PASS" : "FAIL"}  sample.pdf: ${got.map((p) => p.source).join(", ")}`);
await ocr.dispose();
process.exit(same === pages.length && pdfOk ? 0 : 1);
