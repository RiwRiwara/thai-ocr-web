# Security policy

## Supported versions

Security fixes go into the latest release on npm (`thai-ocr-web`) and the live demo.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository. You should get an answer within a week.

## What runs where

- The library and the demo process images and PDFs **on the user's device**. Nothing is uploaded; the only network
  requests are for the library's own files (models, ONNX Runtime, OpenCV.js, pdf.js) from the same site.
- PDFs are read with [pdf.js](https://github.com/mozilla/pdf.js); PDF scripts are not run.
- The models are iApp Technology's OpenThai 2.1 OCR Text files, unchanged (`models/NOTICE`); their checksums can be
  compared with the `SHA256SUMS` file of the
  [model repository](https://huggingface.co/iapp/OpenThai2.1-OCR-Text-20261118).
