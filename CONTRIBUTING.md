# Contributing

Thanks for helping! Bug reports, test pages and pull requests are all welcome.

## Reporting a problem

Open an issue with:

- the browser, its version and the device (e.g. "Safari 26, iPhone 15");
- the backend shown in the demo's status line (WebGPU / WASM, number of threads);
- the error text, if any, and — when you can share it — the image (please remove personal data first).

Pages that read badly are especially useful: they show where the model or the port can improve.

## Working on the code

```bash
npm install
npm run dev     # demo at http://localhost:5173
npm test        # must stay 11/11 identical to the reference runtime
```

- **The port must keep matching the reference runtime.** `npm test` compares the text of every page in `test/pages`
  with `test/golden/`, the output of iApp's Python runtime (v2.1.4). A change to `src/line-ocr.js` that alters the text
  of any page is a bug unless the reference runtime changed too.
- **Adding a test page:** put the PNG in `test/pages/` and its reference output in `test/golden/<name>.json`. The
  reference output comes from the Python runtime in
  [iapp/OpenThai2.1-OCR-Text-20261118](https://huggingface.co/iapp/OpenThai2.1-OCR-Text-20261118) (`LineOCR.read()`,
  ONNX Runtime backend, with `timing` and each line's `words` removed). Only add pages you have the right to share.
- **New OpenCV function?** Add its name to `vendor/opencv/build/whitelist.json` and rebuild (see the README).
- Keep the code plain modern JavaScript (ES modules, no build step for `src/`), and keep `src/index.d.ts` in sync.

## Licence

By contributing you agree that your contribution is licensed under the Apache License 2.0, like the rest of the project.
