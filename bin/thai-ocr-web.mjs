#!/usr/bin/env node
// thai-ocr-web CLI: Thai + English OCR for images and PDFs, on this machine.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const HELP = `Usage: thai-ocr-web <file or folder>... [options]

Reads Thai and English text from images (PNG, JPEG; others with sharp) and PDFs.

Options:
  -o, --out <dir>    write one .txt (or .json) per input into <dir> instead of printing
      --json         output JSON: text, and every line with its box and confidence
      --ocr-all      OCR every PDF page, also pages that already carry text
  -r, --recursive    read folders recursively
  -t, --threads <n>  CPU threads (default: number of cores, at most 8)
  -q, --quiet        no progress on stderr
  -v, --version
  -h, --help

Examples:
  thai-ocr-web scan.png
  thai-ocr-web contract.pdf --json > contract.json
  thai-ocr-web ./scans -r -o ./text`;

const IMAGE = /\.(png|jpe?g|webp|tiff?|bmp|gif|heic|avif)$/i, PDF = /\.pdf$/i;

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" }, json: { type: "boolean" }, "ocr-all": { type: "boolean" },
      recursive: { type: "boolean", short: "r" }, threads: { type: "string", short: "t" },
      quiet: { type: "boolean", short: "q" }, version: { type: "boolean", short: "v" }, help: { type: "boolean", short: "h" },
    },
  });
} catch (e) {
  console.error(`${e.message}\n\n${HELP}`);
  process.exit(2);
}
const { values: o, positionals } = args;
if (o.help) { console.log(HELP); process.exit(0); }
if (o.version) {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  console.log(pkg.version);
  process.exit(0);
}
if (!positionals.length) { console.error(HELP); process.exit(2); }

const log = (s) => { if (!o.quiet) process.stderr.write(s + "\n"); };

function collect(p, top = true) {
  let st;
  try { st = fs.statSync(p); } catch { throw new Error(`no such file or folder: ${p}`); }
  if (st.isDirectory()) {
    if (!top && !o.recursive) return [];
    return fs.readdirSync(p).sort().flatMap((f) => collect(path.join(p, f), false));
  }
  return top || IMAGE.test(p) || PDF.test(p) ? [p] : [];
}

let files;
try { files = positionals.flatMap((p) => collect(p)); } catch (e) { console.error(`thai-ocr-web: ${e.message}`); process.exit(2); }
if (!files.length) { console.error("thai-ocr-web: no images or PDFs found"); process.exit(1); }

const here = path.dirname(fileURLToPath(import.meta.url));
const { createThaiOCR, readImageFile, readPdfFile } = await import(path.join(here, "..", "src", "node.js"));

const t0 = performance.now();
const ocr = await createThaiOCR({ threads: o.threads ? Number(o.threads) : undefined });
log(`thai-ocr-web: model loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s (${ocr.backend})`);

const lineJson = (r) => r.lines.map((l) => ({ text: l.text, confidence: +l.confidence.toFixed(4), box: l.box.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]) }));
let failed = 0;
if (o.out) fs.mkdirSync(o.out, { recursive: true });

for (const file of files) {
  const t = performance.now();
  let text, json;
  try {
    if (PDF.test(file)) {
      const pages = [];
      for await (const p of readPdfFile(ocr, file, {
        useTextLayer: !o["ocr-all"],
        onPage: ({ pageNumber, pageCount }) => log(`  ${path.basename(file)}: page ${pageNumber}/${pageCount}`),
      })) pages.push(p);
      text = pages.map((p) => (pages.length > 1 ? `--- page ${p.pageNumber} ---\n` : "") + p.text.trim()).join("\n\n");
      json = { file, pages: pages.map((p) => ({ page: p.pageNumber, source: p.source, text: p.text, ...(p.result ? { rotation: p.result.rotation, lines: lineJson(p.result) } : {}) })) };
      log(`${file}: ${pages.length} page(s), ${((performance.now() - t) / 1000).toFixed(2)} s`);
    } else {
      const r = await ocr.read(await readImageFile(file));
      text = r.text;
      json = { file, text: r.text, rotation: r.rotation, text_angle: r.text_angle, lines: lineJson(r) };
      log(`${file}: ${r.lines.length} lines, ${((performance.now() - t) / 1000).toFixed(2)} s`);
    }
  } catch (e) {
    failed++;
    console.error(`thai-ocr-web: ${file}: ${String(e.message).replace(/^thai-ocr-web: /, "")}`);
    continue;
  }
  const body = o.json ? JSON.stringify(json, null, 2) : text;
  if (o.out) {
    const name = path.basename(file).replace(/\.[^.]+$/, "") + (o.json ? ".json" : ".txt");
    fs.writeFileSync(path.join(o.out, name), body + "\n");
  } else if (files.length > 1 && !o.json) {
    process.stdout.write(`==> ${file} <==\n${body}\n\n`);
  } else {
    process.stdout.write(body + "\n");
  }
}
await ocr.dispose();
process.exit(failed ? 1 : 0);
