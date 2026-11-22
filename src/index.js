// thai-ocr-web: Thai + English printed-text OCR (OpenThai 2.1 OCR Text) in JavaScript.
// Core API, no bundled dependencies: pass in onnxruntime-web, OpenCV.js and clipper-lib yourself.
// For a ready-made browser setup, import from "thai-ocr-web/browser" instead.
export { LineOCR, DEFAULTS, fixScripts, invalidShare, lineHeight, pageSkew, readingOrder } from "./line-ocr.js";
export { canonical } from "./thai-norm.js";
