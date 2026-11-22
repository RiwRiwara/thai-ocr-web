# Changelog

## 0.2.0 — 2026-11-22

- Node.js: `thai-ocr-web/node` with `createThaiOCR()` (onnxruntime-node when installed, otherwise the WASM build),
  `readImageFile()` (PNG and JPEG built in, other formats with `sharp`) and `readPdfFile()`. Same text as the
  reference runtime on every test page (`test/node.mjs`, in `npm test`).
- Command line: `thai-ocr-web <files or folders>` with `--json`, `--out`, `--ocr-all`, `--recursive`, `--threads`.
- `readPdf()`: `createCanvas` option, so scanned pages can be rendered outside the browser (@napi-rs/canvas in Node).

## 0.1.1 — 2026-11-22

- PDF: detect text layers whose Thai glyphs map to the wrong characters (e.g. "พ=ฒนา", "ด้<ย") and read those pages
  with OCR instead; `brokenShare()` is exported.

## 0.1.0 — 2026-11-22

First release.

- JavaScript port of OpenThai 2.1 OCR Text's runtime (`line_engine.py` v2.1.4): detection, recognition, rec2 for
  loopless fonts, orientation, deskew, column-aware reading order, floating marks, filters, Thai normalisation.
- Output identical to the reference Python runtime on all 11 test pages (`npm test`, run in CI).
- `createThaiOCR()` for the browser: WebGPU with WASM fallback, model caching, one WASM thread on iOS / iPadOS,
  WebGPU runtime split into parts for hosts with a 25 MiB file limit.
- Minimal OpenCV.js 5.0.0 build (0.77 MB gzip) with its build script; OpenCV starts on first use.
- Demo site on Cloudflare Pages with sample pages, line boxes, copy and .txt download, light theme.
- Fixed: loading on iPhone — WebKit re-evaluating the worker module, and "RangeError: Out of memory" from ONNX
  Runtime's 4 GB shared-memory reservation (capped at 512 MB on iOS, `maxMemoryMB`).
- PDF input (`thai-ocr-web/pdf`, pdf.js as an optional peer dependency): a page's own text where it has a usable
  text layer, OCR for scanned pages; progress, page limit, abort. The demo opens PDFs, with a page pager.
- Demo in Thai (default) and English, light gray theme.
