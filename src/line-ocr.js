// LineOCR: a JavaScript port of OpenThai 2.1 OCR Text's runtime (runtime/line_engine.py, v2.1.4).
//
// Ported, with modifications, from iapp/OpenThai2.1-OCR-Text-20261118 (Apache-2.0, iApp Technology).
// The models (det.onnx, rec.onnx, rec2.onnx) are used unchanged; they derive from PaddlePaddle PP-OCRv6-tiny.
// This is an unofficial port, not affiliated with iApp Technology.
//
// Dependencies are passed in, so the same code runs in a browser, a Web Worker or Node:
//   ort         onnxruntime-web (WASM / WebGPU)
//   cv          OpenCV.js, initialised (vendor/opencv/opencv-ocr.mjs is a minimal build with what this file uses)
//   ClipperLib  clipper-lib (Clipper 6, the library pyclipper wraps)
// For the browser, src/browser.js wires these up for you.
//
// Not ported: word boxes (`words`) and the runtime's multi-process service engines.

import { canonical } from "./thai-norm.js";

// ---------------------------------------------------------------------------- config

export const DEFAULTS = {
  det: { limit: 1280, thresh: 0.3, box_thresh: 0.6, unclip: 1.5, min_size: 3, max_candidates: 3000, v_pad: 0.0,
    short_pad: 0.0, rescan_below: 0.0, rescan_target: 20.0, rescan_max: 3200, split_gap: 1.2 },
  rec: { height: 48, max_w: 3200, batch: 16, drop_below: 0.0, min_chars: 1, min_chars_digits: null,
    min_chars_digits_height: 0.0, min_chars_latin: false, junk_below: 0.0, junk_invalid: 1.0, color: "flatten" },
  ori: { enabled: true, sample: 8, flip_below: 0.8, flip_margin: 0.15, deskew_above: 2.5 },
  marks: { enabled: true, max_gap: 0.35, max_ext: 0.9, max_height: 0.9, margin: 0.0, page_share: 0.25, page_min: 3,
    keep_base: true },
  cols: { list_rep: 0.6, list_facing: 0.0, list_max_w: 10.0, list_enum: 0.0 },
  rec2: { file: "", min_mixed: 1 },
  join: { thai_no_space: false, decimal_comma: false, paragraphs: false, paragraph_gap: 1.0 },
};
const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];

// ---------------------------------------------------------------------------- small helpers

const f32 = Math.fround;
const clip = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => sum(a) / a.length;

function median(a) {
  const s = Float64Array.from(a).sort();
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function pyRound(x) { // Python's round(): halves to even
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

function argmin(a) {
  let k = 0;
  for (let i = 1; i < a.length; i++) if (a[i] < a[k]) k = i;
  return k;
}

const boxF32 = (b) => b.map(([x, y]) => [f32(x), f32(y)]);
const xs = (b) => b.map((p) => p[0]);
const ys = (b) => b.map((p) => p[1]);
const boxH = (b) => dist(b[0], b[3]);
const boxW = (b) => dist(b[0], b[1]);

// 3x3 matrices (row-major arrays of arrays)
const eye = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
function matmul(a, b) {
  return a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
}
function inv3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}
const applyM = (m, box) => box.map(([x, y]) => [m[0][0] * x + m[0][1] * y + m[0][2], m[1][0] * x + m[1][1] * y + m[1][2]]);

function rot90Matrix(k, H, W) { // original -> np.rot90(image, k) coordinates
  if (k === 1) return [[0, 1, 0], [-1, 0, W - 1], [0, 0, 1]];
  if (k === -1) return [[0, -1, H - 1], [1, 0, 0], [0, 0, 1]];
  return [[-1, 0, W - 1], [0, -1, H - 1], [0, 0, 1]];
}

// ---------------------------------------------------------------------------- text rules

const DIGITS = new Set("0123456789๐๑๒๓๔๕๖๗๘๙");
const LATIN = new Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz");
// Python's \d on str matches every Unicode decimal digit; \p{Nd} is the JS equivalent.
const DECIMAL_COMMA = /(?<![\p{Nd}.,])(\p{Nd}{1,3}(?:,\p{Nd}{3})*),(\p{Nd}{2})(?![\p{Nd}.,])/gu;
const LONE_W = /(?<![A-Za-z])[Ww](?=\.?[ก-ฮเ-ไ])/g;
const ZERO_IN_THAI = /(?<=[๐-๙])[Oo0]|[Oo0](?=[๐-๙])/g;
const ENUM = /^\s*\(?([0-9๐-๙]{1,4})\s*[.)]/u;
const DIGIT_RUN = /[0-9๐-๙]+/g;
const MARK_RE = /[ัิ-ฺ็-๎\s]/gu;
const MARKS = new Set("ัิีึืฺุู็่้๊๋์ํ๎");
const LEADING = new Set("เแโใไ");

export function fixScripts(text) {
  return text.replace(LONE_W, "พ").replace(ZERO_IN_THAI, "๐");
}

function enumOf(text) {
  const m = ENUM.exec(text);
  if (!m) return null;
  return parseInt(m[1].replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50)), 10);
}

function startRep(lines) {
  const st = lines.filter((x) => x.trim()).map((x) => x.trim().replace(DIGIT_RUN, "D").slice(0, 3));
  if (!st.length) return 0;
  const counts = new Map();
  for (const x of st) counts.set(x, (counts.get(x) || 0) + 1);
  const top = [...counts.values()].sort((a, b) => b - a).slice(0, 2);
  return sum(top) / st.length;
}

function mixed(text) {
  let n = 0;
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    if ([...tok].some((ch) => ch >= "ก" && ch <= "๎")) {
      n += [...tok].filter((ch) => (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")).length;
    }
  }
  return n;
}

const digitsOf = (text) => [...text].filter((ch) => /\p{Nd}/u.test(ch)).join("");
const baseOf = (text) => text.split("ำ").join("า").replace(MARK_RE, "");
const isThai = (ch) => ch >= "฀" && ch <= "๿";
const isCons = (ch) => ch >= "ก" && ch <= "ฮ";

export function invalidShare(text) {
  const t = [...text];
  let thai = 0, bad = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (!isThai(ch)) continue;
    thai++;
    const prev = i ? t[i - 1] : " ";
    if (MARKS.has(ch) && !(isCons(prev) || (MARKS.has(prev) && i >= 2 && isCons(t[i - 2])))) bad++;
    else if (LEADING.has(ch) && !(i + 1 < t.length && isCons(t[i + 1]))) bad++;
  }
  return thai ? bad / thai : 0;
}

// ---------------------------------------------------------------------------- geometry

function orderPoints(pts) { // 4 points -> TL, TR, BR, BL
  const s = [...pts].sort((a, b) => a[0] - b[0]);
  const left = s.slice(0, 2).sort((a, b) => a[1] - b[1]);
  const right = s.slice(2).sort((a, b) => a[1] - b[1]);
  return boxF32([left[0], right[0], right[1], left[1]]);
}

export function lineHeight(boxes) {
  const hs = boxes.map((b) => Math.max(boxH(b), 1));
  const lines = hs.filter((h, i) => boxW(boxes[i]) >= 2 * h);
  return hs.length ? median(lines.length >= 3 ? lines : hs) : 1;
}

export function pageSkew(boxes) {
  const angles = [];
  for (const b of boxes) {
    const dx = b[1][0] - b[0][0], dy = b[1][1] - b[0][1];
    if (Math.hypot(dx, dy) >= 3 * Math.max(boxH(b), 1)) angles.push((Math.atan2(dy, dx) * 180) / Math.PI);
  }
  return angles.length ? median(angles) : 0;
}

function vertical(box, ratio) {
  const w = boxW(box), h = boxH(box);
  return h >= ratio * Math.max(w, 1) ? 1 : w >= ratio * Math.max(h, 1) ? -1 : 0;
}

function fragments(boxes, rec) {
  if (boxes.length < 3) return new Set();
  const hs = boxes.map(boxH);
  const hmed = lineHeight(boxes);
  const out = new Set();
  boxes.forEach((b, i) => {
    if (hs[i] >= 0.35 * hmed || (rec[i] ? rec[i][0] : "").replace(/ /g, "").length > 3) return;
    const x0 = Math.min(...xs(b)), x1 = Math.max(...xs(b)), y0 = Math.min(...ys(b)), y1 = Math.max(...ys(b));
    for (let j = 0; j < boxes.length; j++) {
      const c = boxes[j];
      if (j === i || hs[j] < 0.6 * hmed) continue;
      if (Math.min(...xs(c)) <= x1 && x0 <= Math.max(...xs(c)) &&
          Math.min(Math.abs(y0 - Math.max(...ys(c))), Math.abs(Math.min(...ys(c)) - y1)) <= 0.5 * hmed) {
        out.add(i);
        break;
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------- reading order

function gaps(iv, minGap) {
  iv = [...iv].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  let reach = iv[0][1];
  for (const [lo, hi] of iv.slice(1)) {
    if (lo - reach >= minGap) out.push([reach, lo]);
    reach = Math.max(reach, hi);
  }
  return out;
}

function nextTo(side, ext, hmed, gutterOnRight) {
  if (!side.length) return side;
  const g = gaps(side.map((i) => [ext[i][0], ext[i][1]]), 0.8 * hmed);
  if (!g.length) return side;
  if (gutterOnRight) return side.filter((i) => ext[i][0] >= g[g.length - 1][1]);
  return side.filter((i) => ext[i][1] <= g[0][0]);
}

function prose(col, ext, hmed, texts) {
  if (col.length < 12) return false;
  const widths = col.map((i) => ext[i][1] - ext[i][0]);
  const span = Math.max(...col.map((i) => ext[i][1])) - Math.min(...col.map((i) => ext[i][0]));
  if (median(widths) < 7 * hmed || mean(widths.map((w) => (w >= 0.75 * span ? 1 : 0))) < 0.35) return false;
  if (texts) {
    const chars = col.flatMap((i) => [...texts[i]].filter((c) => !/\s/.test(c)));
    if (chars.length && chars.filter((c) => DIGITS.has(c)).length > 0.3 * chars.length) return false;
    if (new Set(col.map((i) => texts[i].trim())).size < 0.8 * col.length) return false;
  }
  return true;
}

function numberedAcross(lcol, rcol, ext, hmed, texts) {
  if (!texts) return false;
  let pairs = 0;
  for (const i of lcol) {
    const a = enumOf(texts[i]);
    if (a === null) continue;
    const cy = (ext[i][2] + ext[i][3]) / 2;
    if (rcol.some((j) => enumOf(texts[j]) === a + 1 && Math.abs((ext[j][2] + ext[j][3]) / 2 - cy) <= 0.5 * hmed)) pairs++;
  }
  return pairs >= 0.5 * Math.min(lcol.length, rcol.length);
}

function listPair(lcol, rcol, ext, hmed, texts, rules) {
  if (!rules || !(rules.list_rep || rules.list_facing || rules.list_enum) || !lcol.length || !rcol.length) return false;
  if (rules.list_rep && texts) {
    if (mean([lcol, rcol].map((col) => startRep(col.map((i) => texts[i])))) >= rules.list_rep) return true;
  }
  const [small, other] = lcol.length <= rcol.length ? [lcol, rcol] : [rcol, lcol];
  const cy = other.map((j) => (ext[j][2] + ext[j][3]) / 2);
  const face = mean(small.map((i) => (cy.some((c) => Math.abs((ext[i][2] + ext[i][3]) / 2 - c) <= 0.5 * hmed) ? 1 : 0)));
  const wide = Math.max(...[lcol, rcol].map((col) => median(col.map((i) => ext[i][1] - ext[i][0])))) / hmed;
  if (rules.list_facing && face >= rules.list_facing && wide < (rules.list_max_w ?? 10)) return true;
  if (rules.list_enum && texts && face >= 0.6) return mean(lcol.map((i) => (enumOf(texts[i]) !== null ? 1 : 0))) >= rules.list_enum;
  return false;
}

function blocks(idx, ext, hmed, texts, depth, rules) {
  if (idx.length < 6 || depth > 12) return [idx];
  const cuts = [];
  for (const [g0, g1] of gaps(idx.map((i) => [ext[i][0], ext[i][1]]), 0.8 * hmed)) {
    const left = idx.filter((i) => ext[i][1] <= g0);
    const right = idx.filter((i) => ext[i][0] >= g1);
    const lcol = nextTo(left, ext, hmed, true), rcol = nextTo(right, ext, hmed, false);
    if (prose(lcol, ext, hmed, texts) && prose(rcol, ext, hmed, texts) &&
        !numberedAcross(lcol, rcol, ext, hmed, texts) && !listPair(lcol, rcol, ext, hmed, texts, rules)) {
      cuts.push([g1 - g0, left, right]);
    }
  }
  if (cuts.length) {
    let best = cuts[0];
    for (const c of cuts) if (c[0] > best[0]) best = c; // max(): first of equal maxima
    return [...blocks(best[1], ext, hmed, texts, depth + 1, rules), ...blocks(best[2], ext, hmed, texts, depth + 1, rules)];
  }
  const hg = gaps(idx.map((i) => [ext[i][2], ext[i][3]]), 0.8 * hmed);
  if (!hg.length) return bandedColumns(idx, ext, hmed, texts, depth, rules) || [idx];
  let g = hg[0];
  for (const x of hg) if (x[1] - x[0] > g[1] - g[0]) g = x;
  const top = idx.filter((i) => ext[i][3] <= g[0]);
  const bottom = idx.filter((i) => ext[i][2] >= g[1]);
  return [...blocks(top, ext, hmed, texts, depth + 1, rules), ...blocks(bottom, ext, hmed, texts, depth + 1, rules)];
}

function bandedColumns(idx, ext, hmed, texts, depth, rules) {
  const x0 = Math.min(...idx.map((i) => ext[i][0])), x1 = Math.max(...idx.map((i) => ext[i][1]));
  const wide = idx.filter((i) => ext[i][1] - ext[i][0] >= 0.55 * (x1 - x0));
  if (wide.length > 0.15 * idx.length) return null;
  const wideSet = new Set(wide);
  const rest = idx.filter((i) => !wideSet.has(i));
  if (rest.length < 24) return null;
  const lo = Math.trunc(x0 + 0.15 * (x1 - x0)), n = Math.trunc(0.7 * (x1 - x0)) + 1;
  const cover = new Int32Array(n);
  for (const i of rest) {
    const a = Math.max(0, Math.trunc(ext[i][0]) - lo), b = Math.min(n, Math.ceil(ext[i][1]) - lo);
    for (let x = a; x < b; x++) cover[x]++;
  }
  const lim = Math.max(1, Math.trunc(0.03 * rest.length));
  const runs = [];
  let s = null;
  for (let x = 0; x <= n; x++) {
    const f = x < n && cover[x] <= lim;
    if (f && s === null) s = x;
    else if (!f && s !== null) {
      if (x - s >= 0.4 * hmed) runs.push([lo + s, lo + x]);
      s = null;
    }
  }
  let best = null;
  runs.forEach(([g0, g1], k) => {
    const left = rest.filter((i) => ext[i][1] <= g0);
    const right = rest.filter((i) => ext[i][0] >= g1);
    const lcol = left.filter((i) => k === 0 || ext[i][0] >= runs[k - 1][1]);
    const rcol = right.filter((i) => k === runs.length - 1 || ext[i][1] <= runs[k + 1][0]);
    if (prose(lcol, ext, hmed, texts) && prose(rcol, ext, hmed, texts) &&
        !numberedAcross(lcol, rcol, ext, hmed, texts) && !listPair(lcol, rcol, ext, hmed, texts, rules) &&
        (best === null || g1 - g0 > best[0])) best = [g1 - g0, g0, g1];
  });
  if (best === null) return null;
  const [, g0, g1] = best;
  const mid = rest.filter((i) => ext[i][0] < g0 && ext[i][1] > g1);
  const midSet = new Set(mid);
  const cy = (i) => (ext[i][2] + ext[i][3]) / 2;
  const cx = (i) => (ext[i][0] + ext[i][1]) / 2;
  const seps = [...wide, ...mid].sort((a, b) => cy(a) - cy(b));
  const out = [];
  for (let b = 0; b <= seps.length; b++) {
    const blo = b ? cy(seps[b - 1]) : -Infinity;
    const bhi = b < seps.length ? cy(seps[b]) : Infinity;
    const band = rest.filter((i) => !midSet.has(i) && blo < cy(i) && cy(i) <= bhi);
    for (const side of [band.filter((i) => cx(i) < (g0 + g1) / 2), band.filter((i) => cx(i) >= (g0 + g1) / 2)]) {
      if (side.length) out.push(...blocks(side, ext, hmed, texts, depth + 1, rules));
    }
    if (b < seps.length) out.push([seps[b]]);
  }
  return out;
}

export function readingOrder(boxes, angle = null, columns = true, texts = null, rules = null) {
  if (!boxes.length) return [];
  const a = (-(angle === null ? pageSkew(boxes) : angle) * Math.PI) / 180;
  const c = f32(Math.cos(a)), s = f32(Math.sin(a));
  const pts = boxes.map((b) => b.map(([x, y]) => [f32(x * c - y * s), f32(x * s + y * c)]));
  const extOf = (p) => [Math.min(...xs(p)), Math.max(...xs(p)), Math.min(...ys(p)), Math.max(...ys(p))];
  const ext = pts.map(extOf);
  const hmed = lineHeight(boxes);
  const idx = boxes.map((_, i) => i);
  let blks = columns ? blocks(idx, ext, hmed, texts, 0, rules) : [idx];
  if (columns && a) {
    const alt = blocks(idx, boxes.map(extOf), hmed, texts, 0, rules);
    if (alt.length > blks.length) blks = alt;
  }
  const cy = ext.map((e) => (e[2] + e[3]) / 2);
  const rx = ext.map((e) => (e[0] + e[1]) / 2);
  const hs = boxes.map((b) => Math.max(boxH(b), 1));
  const tol = 0.5 * hmed;
  const rows = [];
  for (const blk of blks) {
    let full = blk.filter((i) => hs[i] >= 0.6 * hmed);
    if (!full.length) full = [...blk];
    const fullSet = new Set(full);
    const small = blk.filter((i) => !fullSet.has(i));
    const brows = [];
    for (const i of [...full].sort((p, q) => cy[p] - cy[q])) {
      if (brows.length && Math.abs(cy[i] - mean(brows[brows.length - 1].map((j) => cy[j]))) <= tol) brows[brows.length - 1].push(i);
      else brows.push([i]);
    }
    const centre = brows.map((r) => mean(r.map((j) => cy[j])));
    for (const i of small) {
      const d = centre.map((cc) => Math.abs(cy[i] - cc));
      if (d.length && Math.min(...d) <= tol + 0.5 * hs[i]) brows[argmin(d)].push(i);
      else { brows.push([i]); centre.push(cy[i]); }
    }
    const order = brows.map((_, r) => r).sort((p, q) => centre[p] - centre[q]);
    for (const r of order) rows.push([...brows[r]].sort((p, q) => rx[p] - rx[q]));
  }
  return rows;
}

// ---------------------------------------------------------------------------- engine

export class LineOCR {
  /**
   * @param {object} o
   * @param {object} o.ort  onnxruntime-web / onnxruntime-node module
   * @param {object} o.cv   initialised OpenCV.js
   * @param {object} o.ClipperLib  clipper-lib module
   * @param {(name: string) => Promise<Uint8Array|string>} o.loadFile  fetches a file of the model directory
   * @param {string[]} [o.executionProviders]  e.g. ["webgpu", "wasm"]
   * @param {object} [o.overrides]  config sections to override, as LineOCR(**overrides) in Python
   */
  static async create({ ort, cv, ClipperLib, loadFile, executionProviders, overrides = {}, sessionOptions = {} }) {
    const self = new LineOCR();
    self.ort = ort; self.cv = cv; self.CL = ClipperLib;
    const cfg = JSON.parse(JSON.stringify(DEFAULTS));
    const text = async (n) => { const d = await loadFile(n); return typeof d === "string" ? d : new TextDecoder().decode(d); };
    const det = parsePostprocess(await text("det.yml"));
    for (const [src, dst] of [["thresh", "thresh"], ["box_thresh", "box_thresh"], ["unclip_ratio", "unclip"]]) {
      if (typeof det[src] === "number") cfg.det[dst] = det[src];
    }
    let user = {};
    try { user = JSON.parse(await text("config.json")); } catch { /* optional */ }
    for (const section of [user, overrides]) for (const [k, v] of Object.entries(section)) cfg[k] = { ...(cfg[k] || {}), ...v };
    self.cfg = cfg;
    const chars = (await text("rec_dict.txt")).split("\n").filter((c) => c);
    self.chars = ["", ...chars, " "];
    const opts = { graphOptimizationLevel: "all", ...sessionOptions };
    if (executionProviders) opts.executionProviders = executionProviders;
    const sess = async (n) => ort.InferenceSession.create(await loadFile(n), opts);
    self.det = await sess("det.onnx");
    self.rec = await sess("rec.onnx");
    self.rec2 = cfg.rec2.file ? await sess(cfg.rec2.file) : null;
    return self;
  }

  async _run(session, data, dims) {
    const feeds = { [session.inputNames[0]]: new this.ort.Tensor("float32", data, dims) };
    const out = await session.run(feeds);
    const t = out[session.outputNames[0]];
    const res = { data: t.data instanceof Float32Array ? t.data : await t.getData(), dims: t.dims };
    t.dispose?.();
    return res;
  }

  // -- image helpers (cv.Mat in, cv.Mat out; caller deletes) -------------------

  /** Accepts a cv.Mat (BGR or grey), or ImageData-like {data (RGBA), width, height}. Returns a new BGR Mat. */
  toBGR(image) {
    const cv = this.cv;
    if (image instanceof cv.Mat) {
      const out = new cv.Mat();
      if (image.channels() === 3) image.copyTo(out);
      else if (image.channels() === 1) cv.cvtColor(image, out, cv.COLOR_GRAY2BGR);
      else cv.cvtColor(image, out, cv.COLOR_RGBA2BGR);
      return out;
    }
    const rgba = new cv.Mat(image.height, image.width, cv.CV_8UC4);
    rgba.data.set(image.data);
    const out = new cv.Mat();
    cv.cvtColor(rgba, out, cv.COLOR_RGBA2BGR);
    rgba.delete();
    return out;
  }

  cropLine(img, box, turn = 1) {
    const cv = this.cv;
    const w = Math.max(Math.trunc(Math.max(dist(box[0], box[1]), dist(box[2], box[3]))), 1);
    const h = Math.max(Math.trunc(Math.max(dist(box[0], box[3]), dist(box[1], box[2]))), 1);
    const src = cv.matFromArray(4, 1, cv.CV_32FC2, box.flat());
    const dst = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
    const m = cv.getPerspectiveTransform(src, dst);
    const out = new cv.Mat();
    cv.warpPerspective(img, out, m, new cv.Size(w, h), cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
    src.delete(); dst.delete(); m.delete();
    if (turn && h / w >= 1.5) return this.rot90(out, turn, true);
    return out;
  }

  rot90(mat, k, del = false) { // np.rot90 semantics: k=1 counter-clockwise
    const cv = this.cv;
    const out = new cv.Mat();
    const code = k === 1 ? cv.ROTATE_90_COUNTERCLOCKWISE : k === -1 ? cv.ROTATE_90_CLOCKWISE : cv.ROTATE_180;
    cv.rotate(mat, out, code);
    if (del) mat.delete();
    return out;
  }

  /** Dark text on white from a grey line crop (runtime's _flatten). g: Uint8Array h*w. Returns Uint8Array. */
  flatten(g, h, w) {
    const cv = this.cv;
    const k = Math.max(2, Math.trunc(h / 6));
    const bg = new Uint8Array(w);
    const col = new Float64Array(2 * k);
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let y = 0; y < k; y++) col[n++] = g[y * w + x];
      for (let y = h - k; y < h; y++) col[n++] = g[y * w + x];
      // rows that the top and bottom margins share (h < 2k) count twice, as in np.concatenate
      bg[x] = Math.trunc(median(col.subarray(0, n)));
    }
    const win = Math.max(3, Math.min(h | 1, 255));
    const three = new cv.Mat(3, w, cv.CV_8UC1);
    three.data.set(bg, 0); three.data.set(bg, w); three.data.set(bg, 2 * w);
    const blur = new cv.Mat();
    cv.medianBlur(three, blur, win);
    const bgs = blur.data.slice(w, 2 * w);
    three.delete(); blur.delete();
    const d = new Float32Array(h * w);
    const hist = new Float64Array(256);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = Math.abs(g[y * w + x] - bgs[x]);
        d[y * w + x] = v;
        hist[v | 0]++;
      }
    }
    for (let i = 1; i < 256; i++) hist[i] += hist[i - 1];
    const target = 0.98 * hist[255];
    let pos = 0;
    while (pos < 256 && hist[pos] < target) pos++;
    const hi = Math.max(pos, 24);
    const out = new Uint8Array(h * w);
    for (let i = 0; i < out.length; i++) out[i] = 255 - Math.min(Math.max(d[i] * (255 / hi), 0), 255);
    return out;
  }

  // -- detection ---------------------------------------------------------------

  async detect(img) {
    const c = this.cfg.det;
    let boxes = await this._detectAt(img, c.limit);
    if (c.rescan_below && c.limit && boxes.length) {
      const H0 = img.rows, W0 = img.cols;
      const pad = Math.max(8, Math.trunc(0.05 * Math.min(H0, W0)));
      const s = Math.min(c.limit / Math.max(H0 + 2 * pad, W0 + 2 * pad), 4.0);
      const hdet = lineHeight(boxes) * s;
      if (s < 1 && hdet < c.rescan_below) {
        const limit = Math.min(c.rescan_max, (c.limit * c.rescan_target) / Math.max(hdet, 1));
        if (limit > c.limit * 1.15) boxes = await this._detectAt(img, limit);
      }
    }
    return boxes;
  }

  async _detectAt(img0, limit) {
    const cv = this.cv, c = this.cfg.det;
    const H0 = img0.rows, W0 = img0.cols;
    const pad = Math.max(8, Math.trunc(0.05 * Math.min(H0, W0)));
    const img = new cv.Mat();
    cv.copyMakeBorder(img0, img, pad, pad, pad, pad, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
    const h = img.rows, w = img.cols;
    const s = limit ? Math.min(limit / Math.max(h, w), 4.0) : 1.0;
    const rh = Math.max(32, pyRound((h * s) / 32) * 32), rw = Math.max(32, pyRound((w * s) / 32) * 32);
    const rs = new cv.Mat();
    cv.resize(img, rs, new cv.Size(rw, rh), 0, 0, cv.INTER_LINEAR);
    img.delete();
    const n = rw * rh, x = new Float32Array(3 * n), px = rs.data;
    for (let i = 0; i < n; i++) {
      for (let ch = 0; ch < 3; ch++) x[ch * n + i] = (f32(px[3 * i + ch] / 255) - DET_MEAN[ch]) / DET_STD[ch];
    }
    rs.delete();
    const { data: prob, dims } = await this._run(this.det, x, [1, 3, rh, rw]);
    const ph = dims[2], pw = dims[3];
    const bitmap = new cv.Mat(ph, pw, cv.CV_8UC1);
    for (let i = 0; i < ph * pw; i++) bitmap.data[i] = prob[i] > c.thresh ? 1 : 0;
    const contours = new cv.MatVector(), hier = new cv.Mat();
    cv.findContours(bitmap, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    bitmap.delete(); hier.delete();
    const sx = w / pw, sy = h / ph;
    const boxes = [];
    const nc = Math.min(contours.size(), Math.trunc(c.max_candidates));
    for (let k = 0; k < nc; k++) {
      const cnt = contours.get(k);
      let [box, side] = this._miniBox(cnt);
      cnt.delete();
      if (side < c.min_size || this._boxScore(prob, ph, pw, box) < c.box_thresh) continue;
      const core = side;
      const big = this._unclip(box, c.unclip);
      if (!big) continue;
      const bm = cv.matFromArray(big.length, 1, cv.CV_32FC2, big.flat());
      [box, side] = this._miniBox(bm);
      bm.delete();
      if (side < c.min_size + 2) continue;
      let grow = 0;
      if (c.short_pad && dist(box[0], box[1]) >= dist(box[0], box[3])) {
        grow = Math.max(0, c.short_pad * (1 + c.unclip) * core - side) / 2;
      }
      box = boxF32(box.map(([bx, by]) => [clip(f32(bx * sx) - pad, 0, W0 - 1), clip(f32(by * sy) - pad, 0, H0 - 1)]));
      if (grow > 0) {
        let v = [box[3][0] - box[0][0], box[3][1] - box[0][1]];
        const nv = Math.max(Math.hypot(v[0], v[1]), 1e-6);
        v = [(v[0] / nv) * grow * sy, (v[1] / nv) * grow * sy];
        for (const i of [0, 1]) { box[i][0] -= v[0]; box[i][1] -= v[1]; }
        for (const i of [2, 3]) { box[i][0] += v[0]; box[i][1] += v[1]; }
        box = boxF32(box.map(([bx, by]) => [clip(bx, 0, W0 - 1), clip(by, 0, H0 - 1)]));
      }
      if (c.v_pad) {
        const hh = (Math.max(dist(box[0], box[3]), 1) * c.v_pad) / 2;
        for (const i of [0, 1]) box[i][1] = f32(clip(box[i][1] - hh, 0, H0 - 1));
        for (const i of [2, 3]) box[i][1] = f32(clip(box[i][1] + hh, 0, H0 - 1));
      }
      if (Math.max(...xs(box)) - Math.min(...xs(box)) >= 2 && Math.max(...ys(box)) - Math.min(...ys(box)) >= 2) boxes.push(box);
    }
    contours.delete();
    return boxes;
  }

  _miniBox(contourMat) {
    const rect = this.cv.minAreaRect(contourMat);
    const pts = this.cv.RotatedRect.points(rect).map((p) => [p.x, p.y]);
    return [orderPoints(pts), Math.min(rect.size.width, rect.size.height)];
  }

  _boxScore(prob, h, w, box) {
    const cv = this.cv;
    const x0 = clip(Math.floor(Math.min(...xs(box))), 0, w - 1), x1 = clip(Math.ceil(Math.max(...xs(box))), 0, w - 1);
    const y0 = clip(Math.floor(Math.min(...ys(box))), 0, h - 1), y1 = clip(Math.ceil(Math.max(...ys(box))), 0, h - 1);
    const mh = y1 - y0 + 1, mw = x1 - x0 + 1;
    const mask = cv.Mat.zeros(mh, mw, cv.CV_8UC1);
    const poly = cv.matFromArray(4, 1, cv.CV_32SC2, box.flatMap(([x, y]) => [Math.trunc(x - x0), Math.trunc(y - y0)]));
    const pv = new cv.MatVector();
    pv.push_back(poly);
    cv.fillPoly(mask, pv, new cv.Scalar(1));
    let s = 0, n = 0;
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        if (mask.data[y * mw + x]) { s += prob[(y + y0) * w + x + x0]; n++; }
      }
    }
    mask.delete(); poly.delete(); pv.delete();
    return n ? s / n : 0;
  }

  _unclip(box, ratio) {
    let area = 0, length = 0;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = box[i], [bx, by] = box[(i + 1) % 4];
      area += ax * by - bx * ay;
      length += Math.hypot(bx - ax, by - ay);
    }
    area = Math.abs(area) / 2;
    if (length === 0) return null;
    const CL = this.CL;
    const off = new CL.ClipperOffset(2.0, 0.25);
    off.AddPath(box.map(([x, y]) => ({ X: Math.trunc(x), Y: Math.trunc(y) })), CL.JoinType.jtRound, CL.EndType.etClosedPolygon);
    const out = new CL.Paths();
    off.Execute(out, (area * ratio) / length);
    return out.length ? out[0].map((p) => [p.X, p.Y]) : null;
  }

  // -- recognition -------------------------------------------------------------

  /** Grey line image at the recognizer's height, as the runtime's "flatten" colour mode prepares it. */
  _prepCrop(crop) {
    const cv = this.cv, c = this.cfg.rec, H = Math.trunc(c.height);
    if (!crop.rows || !crop.cols) return { g: new Uint8Array(0), h: 0, w: 0 };
    const mode = c.color;
    let src = crop;
    if (mode === "flatten") {
      src = new cv.Mat();
      const rw = Math.max(1, Math.ceil((H * crop.cols) / Math.max(crop.rows, 1)));
      cv.resize(crop, src, new cv.Size(rw, H), 0, 0, cv.INTER_LINEAR);
    }
    const gm = new cv.Mat();
    if (src.channels() === 3) cv.cvtColor(src, gm, cv.COLOR_BGR2GRAY); else src.copyTo(gm);
    if (src !== crop) src.delete();
    const h = gm.rows, w = gm.cols;
    let g = gm.data.slice();
    gm.delete();
    if (mode === "flatten") g = this.flatten(g, h, w);
    else if (mode !== "gray" && mode !== "bgr") {
      const hist = new Float64Array(256);
      for (const v of g) hist[v]++;
      for (let i = 1; i < 256; i++) hist[i] += hist[i - 1];
      const q = (p) => { let k = 0; while (k < 256 && hist[k] < p * hist[255]) k++; return k; };
      const lo = q(0.02), med = q(0.5), hi = q(0.98);
      let lut = Array.from({ length: 256 }, (_, i) => i);
      if (mode === "stretch" && hi - lo >= 16) lut = lut.map((v) => clip((v - lo) * (255 / (hi - lo)), 0, 255));
      if (lut[med] < 128) lut = lut.map((v) => 255 - v);
      g = g.map((v) => lut[v] | 0);
    }
    return { g, h, w };
  }

  async recognizeDetail(crops, session = null) {
    const cv = this.cv, c = this.cfg.rec;
    const H = Math.trunc(c.height), maxW = Math.trunc(c.max_w), bs = Math.trunc(c.batch);
    const prepped = crops.map((cr) => this._prepCrop(cr));
    const ratios = prepped.map((p) => p.w / Math.max(p.h, 1));
    const out = new Array(crops.length).fill(null).map(() => ["", 0, []]);
    const order = ratios.map((_, i) => i).sort((a, b) => ratios[a] - ratios[b]);
    for (let b = 0; b < order.length; b += bs) {
      const idx = order.slice(b, b + bs);
      const W = Math.min(maxW, Math.max(16, Math.ceil(H * Math.max(...idx.map((i) => ratios[i])))));
      const batch = new Float32Array(idx.length * 3 * H * W); // 0 = mid-grey after normalising
      const widths = [];
      idx.forEach((i, n) => {
        const p = prepped[i];
        const rw = Math.min(W, Math.max(1, Math.ceil(H * ratios[i])));
        widths.push(rw);
        let g = p.g;
        if (p.w !== rw || p.h !== H) {
          const m = new cv.Mat(p.h, p.w, cv.CV_8UC1);
          m.data.set(p.g);
          const r = new cv.Mat();
          cv.resize(m, r, new cv.Size(rw, H), 0, 0, cv.INTER_LINEAR);
          g = r.data.slice();
          m.delete(); r.delete();
        }
        const base = n * 3 * H * W;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < rw; x++) {
            const v = (f32(g[y * rw + x] / 255) - 0.5) / 0.5;
            batch[base + y * W + x] = v;
            batch[base + H * W + y * W + x] = v;
            batch[base + 2 * H * W + y * W + x] = v;
          }
        }
      });
      const { data, dims } = await this._run(session || this.rec, batch, [idx.length, 3, H, W]);
      const T = dims[1], K = dims[2];
      idx.forEach((i, n) => {
        out[i] = this._ctcDetail(data.subarray(n * T * K, (n + 1) * T * K), T, K, W / T, widths[n]);
      });
    }
    return out;
  }

  _ctcDetail(p, T, K, stride, width) {
    const ids = new Int32Array(T), conf = new Float32Array(T);
    for (let t = 0; t < T; t++) {
      let best = 0, bv = p[t * K];
      for (let k = 1; k < K; k++) if (p[t * K + k] > bv) { bv = p[t * K + k]; best = k; }
      ids[t] = best; conf[t] = bv;
    }
    const chars = [], probs = [];
    let t = 0;
    while (t < T) {
      let end = t + 1;
      while (end < T && ids[end] === ids[t]) end++;
      if (ids[t] !== 0) {
        const ch = ids[t] < this.chars.length ? this.chars[ids[t]] : "";
        chars.push([ch, Math.min(1, (t * stride) / width), Math.min(1, (end * stride) / width), conf[t]]);
        probs.push(conf[t]);
      }
      t = end;
    }
    return [chars.map((x) => x[0]).join(""), probs.length ? mean(probs) : 0, chars];
  }

  async recognize(crops) {
    return (await this.recognizeDetail(crops)).map(([t, c]) => [t, c]);
  }

  // -- page --------------------------------------------------------------------

  /**
   * Read one page.
   * @param image cv.Mat (BGR/grey/RGBA) or ImageData-like {data, width, height}
   * @returns {Promise<{text, lines:[{text,confidence,row,box}], dropped, text_angle, rotation, timing}>}
   */
  async read(image) {
    const cv = this.cv;
    let img = this.toBGR(image);
    const t0 = performance.now();
    try {
      let boxes = await this.detect(img);
      const h = img.rows, w = img.cols;
      if (!boxes.length && h <= 200 && w >= 1.5 * h) boxes = [[[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]]];
      const oc = this.cfg.ori;
      let rotation = 0, skew = 0, tf = eye();
      if (oc.enabled) {
        const k = await this._sideways(img, boxes);
        if (k) {
          tf = matmul(rot90Matrix(k, img.rows, img.cols), tf);
          img = this.rot90(img, k, true);
          boxes = await this.detect(img);
          rotation = k === -1 ? 90 : 270;
        }
        skew = pageSkew(boxes);
        if (Math.abs(skew) >= oc.deskew_above) {
          const [d, m] = this._deskew(img, skew);
          img.delete();
          img = d;
          tf = matmul(m, tf);
          boxes = await this.detect(img);
        }
      }
      const t1 = performance.now();
      let page = await this._page(img, boxes);
      if (oc.enabled && !rotation && (await this._upsideDown(img, page.boxes, page))) {
        tf = matmul(rot90Matrix(2, img.rows, img.cols), tf);
        img = this.rot90(img, 2, true);
        boxes = await this.detect(img);
        rotation = 180;
        page = await this._page(img, boxes);
      }
      const frag = fragments(page.boxes, page.rec);
      if (this.cfg.marks.enabled) for (const j of await this._attachMarks(img, page, frag)) frag.add(j);
      boxes = page.boxes;
      const back = inv3(tf);
      const t2 = performance.now();
      const lines = [], rowTexts = [], rowGeom = [], dropped = [];
      const hmed = boxes.length ? lineHeight(boxes) : 1;
      const r1 = (v) => Math.round(v * 10) / 10;
      page.rows.forEach((r, ri) => {
        const parts = [];
        for (const i of r) {
          const [raw, conf] = page.rec[i];
          let text = fixScripts(canonical(raw));
          if (this.cfg.join.decimal_comma) text = text.replace(DECIMAL_COMMA, "$1.$2");
          if (frag.has(i)) continue;
          const reason = this._dropReason(text, conf, boxH(boxes[i]) / hmed);
          const entry = { text, confidence: Math.round(conf * 1e4) / 1e4, row: ri,
            box: applyM(back, boxes[i]).map(([x, y]) => [r1(x), r1(y)]) };
          if (reason) { dropped.push({ ...entry, reason }); continue; }
          parts.push(text);
          lines.push(entry);
        }
        if (parts.length) {
          rowTexts.push(parts.join(" "));
          const yv = r.filter((j) => !frag.has(j)).flatMap((j) => ys(boxes[j]));
          rowGeom.push(yv.length ? [Math.min(...yv), Math.max(...yv)] : null);
        }
      });
      const straightened = Math.abs(skew) >= oc.deskew_above ? skew : 0;
      return { text: this._join(rowTexts, rowGeom, hmed), lines, dropped,
        text_angle: Math.round((page.angle + straightened) * 100) / 100, rotation,
        timing: { det_ms: Math.round((t1 - t0) * 10) / 10, rec_ms: Math.round((t2 - t1) * 10) / 10, n_lines: Object.keys(page.rec).length } };
    } finally {
      img.delete();
    }
  }

  _deskew(img, angle) {
    const cv = this.cv;
    const H = img.rows, W = img.cols;
    const mm = cv.getRotationMatrix2D(new cv.Point(W / 2, H / 2), angle, 1.0);
    const m = [[mm.doubleAt(0, 0), mm.doubleAt(0, 1), mm.doubleAt(0, 2)], [mm.doubleAt(1, 0), mm.doubleAt(1, 1), mm.doubleAt(1, 2)]];
    const c = Math.abs(m[0][0]), s = Math.abs(m[0][1]);
    const nW = pyRound(H * s + W * c), nH = pyRound(H * c + W * s);
    m[0][2] += nW / 2 - W / 2;
    m[1][2] += nH / 2 - H / 2;
    mm.data64F.set([...m[0], ...m[1]]);
    const px = img.data, ch = [[], [], []];
    const push = (y, x) => { const o = (y * W + x) * 3; for (let k = 0; k < 3; k++) ch[k].push(px[o + k]); };
    for (let x = 0; x < W; x++) push(0, x);
    for (let x = 0; x < W; x++) push(H - 1, x);
    for (let y = 0; y < H; y++) push(y, 0);
    for (let y = 0; y < H; y++) push(y, W - 1);
    const fill = ch.map((a) => Math.trunc(median(a)));
    const out = new cv.Mat();
    cv.warpAffine(img, out, mm, new cv.Size(nW, nH), cv.INTER_CUBIC, cv.BORDER_CONSTANT, new cv.Scalar(fill[0], fill[1], fill[2], 255));
    mm.delete();
    return [out, [...m, [0, 0, 1]]];
  }

  _splitOne(img, b, ratio) {
    if (!ratio) return [b];
    const cv = this.cv;
    const c = this.cropLine(img, b, 0);
    const h = c.rows, w = c.cols;
    if (w < 4 * h || h < 4) { c.delete(); return [b]; }
    const gm = new cv.Mat();
    cv.cvtColor(c, gm, cv.COLOR_BGR2GRAY);
    c.delete();
    const fl = this.flatten(gm.data.slice(), h, w);
    gm.delete();
    const segs = [];
    let start = null, blank = 0;
    for (let x = 0; x < w; x++) {
      let on = false;
      for (let y = 0; y < h; y++) if (fl[y * w + x] < 128) { on = true; break; }
      if (on) {
        if (start === null) start = x;
        else if (blank >= ratio * h) { segs.push([start, x - blank]); start = x; }
        blank = 0;
      } else if (start !== null) blank++;
    }
    if (start !== null) segs.push([start, w - blank]);
    if (!segs.length || (segs.length === 1 && segs[0][0] < ratio * h && w - segs[0][1] < ratio * h)) return [b];
    const top = [b[1][0] - b[0][0], b[1][1] - b[0][1]], bot = [b[2][0] - b[3][0], b[2][1] - b[3][1]];
    const pad = 0.15 * h;
    return segs.map(([x0, x1]) => {
      const t0 = Math.max(0, (x0 - pad) / w), t1 = Math.min(1, (x1 + pad) / w);
      return boxF32([
        [b[0][0] + t0 * top[0], b[0][1] + t0 * top[1]], [b[0][0] + t1 * top[0], b[0][1] + t1 * top[1]],
        [b[3][0] + t1 * bot[0], b[3][1] + t1 * bot[1]], [b[3][0] + t0 * bot[0], b[3][1] + t0 * bot[1]],
      ]);
    });
  }

  async _page(img, boxes) {
    const groups = boxes.map((b) => this._splitOne(img, b, this.cfg.det.split_gap));
    const changed = boxes.map((b, i) => groups[i].length > 1 || groups[i][0] !== b);
    const pieces = groups.flat();
    const whole = boxes.filter((_, i) => changed[i]);
    const res = await this._readBoxes(img, [...pieces, ...whole]);
    const final = [], out = [];
    let k = 0, e = pieces.length;
    boxes.forEach((b, bi) => {
      const g = groups[bi];
      const r = res.slice(k, k + g.length);
      k += g.length;
      if (changed[bi]) {
        const alt = res[e++];
        const nPieces = sum(r.map((x) => x[0].replace(/ /g, "").length));
        if (Math.min(...r.map((x) => x[1])) < this.cfg.rec.drop_below || nPieces < 0.9 * alt[0].replace(/ /g, "").length) {
          final.push(b); out.push(alt); return;
        }
      }
      final.push(...g); out.push(...r);
    });
    const angle = pageSkew(final);
    const rows = readingOrder(final, angle, true, out.map((x) => x[0]), this.cfg.cols);
    const rec = {}, chars = {};
    out.forEach((x, i) => { rec[i] = [x[0], x[1]]; chars[i] = x[2]; });
    return { rows, angle, rec, chars, boxes: final };
  }

  async _readBoxes(img, boxes) {
    const raw = boxes.map((b) => this.cropLine(img, b, 0));
    try {
      const tall = raw.map((c, n) => (c.rows >= 1.5 * c.cols ? n : -1)).filter((n) => n >= 0);
      const turned = [1, -1].flatMap((k) => tall.map((n) => this.rot90(raw[n], k)));
      const res = await this.recognizeDetail([...raw, ...turned]);
      turned.forEach((m) => m.delete());
      const out = res.slice(0, raw.length);
      tall.forEach((n, j) => {
        for (const alt of [res[raw.length + j], res[raw.length + tall.length + j]]) {
          if (alt[1] > out[n][1]) out[n] = [alt[0], alt[1], null];
        }
      });
      if (this.rec2) {
        const sus = out.map((r, n) => (r[2] !== null && mixed(r[0]) >= this.cfg.rec2.min_mixed ? n : -1)).filter((n) => n >= 0);
        if (sus.length) {
          const alts = await this.recognizeDetail(sus.map((n) => raw[n]), this.rec2);
          sus.forEach((n, j) => { if (mixed(alts[j][0]) < mixed(out[n][0])) out[n] = alts[j]; });
        }
      }
      return out;
    } finally {
      raw.forEach((m) => m.delete());
    }
  }

  async _sideways(img, boxes) {
    const votes = boxes.map((b) => vertical(b, 2.0));
    let vert = boxes.filter((_, i) => votes[i] === 1);
    if (vert.length < 3 || vert.length <= votes.filter((v) => v === -1).length) return 0;
    vert = [...vert].sort((a, b) => boxH(b) - boxH(a)).slice(0, this.cfg.ori.sample);
    const raw = vert.map((b) => this.cropLine(img, b, 0));
    const turned = [1, -1].flatMap((k) => raw.map((c) => this.rot90(c, k)));
    raw.forEach((m) => m.delete());
    const res = await this.recognize(turned);
    turned.forEach((m) => m.delete());
    const ccw = sum(res.slice(0, raw.length).map((r) => r[1]));
    const cw = sum(res.slice(raw.length).map((r) => r[1]));
    return ccw > cw ? 1 : -1;
  }

  async _upsideDown(img, boxes, page) {
    const oc = this.cfg.ori;
    const confs = Object.values(page.rec).filter(([t]) => [...t].length >= 2).map(([, c]) => c);
    if (confs.length < 3 || median(confs) >= oc.flip_below) return false;
    const idx = Object.keys(page.rec).map(Number).filter((i) => vertical(boxes[i], 2.0) === -1)
      .sort((a, b) => boxW(boxes[b]) - boxW(boxes[a])).slice(0, oc.sample);
    if (idx.length < 3) return false;
    const up = mean(idx.map((i) => page.rec[i][1]));
    const flipped = idx.map((i) => this.rot90(this.cropLine(img, boxes[i], 0), 2, true));
    const res = await this.recognize(flipped);
    flipped.forEach((m) => m.delete());
    return mean(res.map((r) => r[1])) > up + oc.flip_margin;
  }

  _dropReason(text, conf, hratio = null) {
    const rc = this.cfg.rec;
    if (!text) return "empty";
    if (conf < rc.drop_below) return "low_confidence";
    const bare = text.replace(/ /g, "");
    let short = rc.min_chars;
    const inCls = (ch) => DIGITS.has(ch) || (rc.min_chars_latin && LATIN.has(ch));
    if (rc.min_chars_digits !== null && rc.min_chars_digits !== undefined && bare && [...bare].every(inCls) &&
        ((rc.min_chars_digits_height || 0) <= 0 || (hratio !== null && hratio >= rc.min_chars_digits_height))) {
      short = rc.min_chars_digits;
    }
    if ([...bare].length < short) return "too_short";
    if (conf < rc.junk_below && invalidShare(text) > rc.junk_invalid) return "invalid_thai";
    return null;
  }

  async _attachMarks(img, page, frag) {
    const mc = this.cfg.marks;
    const { boxes, rec } = page;
    const n = boxes.length;
    let hmed = n ? lineHeight(boxes) : 1;
    const junk = boxes.map((b, i) => frag.has(i) ||
      this._dropReason(fixScripts(canonical(rec[i][0])), rec[i][1], boxH(b) / hmed) !== null);
    if (!junk.some(Boolean) || junk.every(Boolean)) return new Set();
    hmed = lineHeight(boxes.filter((_, i) => !junk[i]));
    const frame = new Map();
    for (let a = 0; a < n; a++) {
      if (junk[a]) continue;
      const b = boxes[a];
      const wa = dist(b[1], b[0]), ha = dist(b[3], b[0]);
      if (wa >= 1 && ha >= 0.5 * hmed) {
        frame.set(a, [b[0], [(b[1][0] - b[0][0]) / wa, (b[1][1] - b[0][1]) / wa], [(b[3][0] - b[0][0]) / ha, (b[3][1] - b[0][1]) / ha], wa, ha]);
      }
    }
    if (!frame.size) return new Set();
    const proj = (a, j) => {
      const [o, u, v] = frame.get(a);
      const s = [], t = [];
      for (const [x, y] of boxes[j]) {
        const px = x - o[0], py = y - o[1];
        s.push(px * u[0] + py * u[1]); t.push(px * v[0] + py * v[1]);
      }
      return [Math.min(...s), Math.max(...s), Math.min(...t), Math.max(...t)];
    };
    const reach = new Map([...frame.keys()].map((a) => [a, [0, 0]]));
    const owner = new Map();
    for (let j = 0; j < n; j++) {
      if (!junk[j]) continue;
      let best = null;
      for (const [a, [, , , wa, ha]] of frame) {
        const [s0, s1, t0, t1] = proj(a, j);
        if (t1 - t0 > mc.max_height * ha || Math.min(s1, wa) - Math.max(s0, 0) < 0.5 * (s1 - s0)) continue;
        let gap, side, ext;
        if (t1 <= 0.5 * ha) [gap, side, ext] = [Math.max(0, -t1), 0, -t0];
        else if (t0 >= 0.5 * ha) [gap, side, ext] = [Math.max(0, t0 - ha), 1, t1 - ha];
        else continue;
        if (gap > mc.max_gap * ha || ext > mc.max_ext * ha) continue;
        if (best === null || gap < best[0] || (gap === best[0] && side < best[1])) best = [gap, side, a, ext];
      }
      if (best) {
        const [, side, a, ext] = best;
        owner.set(j, a);
        reach.get(a)[side] = Math.max(reach.get(a)[side], ext);
      }
    }
    if (!owner.size) return new Set();
    let floating = false;
    for (const side of [0, 1]) {
      const lifted = [...frame.keys()].filter((a) => reach.get(a)[side] > 0);
      if (lifted.length < Math.max(mc.page_min, mc.page_share * frame.size)) continue;
      floating = true;
      const typ = median(lifted.map((a) => reach.get(a)[side] / frame.get(a)[4]));
      for (const a of frame.keys()) {
        if (reach.get(a)[side] > 0) continue;
        const [, , , wa, ha] = frame.get(a);
        let room = typ * ha;
        for (const b of frame.keys()) {
          if (b === a) continue;
          const [s0, s1, t0, t1] = proj(a, b);
          if (Math.min(s1, wa) - Math.max(s0, 0) <= 0) continue;
          if (side === 0 && t1 <= 0.5 * ha) room = Math.min(room, Math.max(0, -t1 * 0.9));
          else if (side === 1 && t0 >= 0.5 * ha) room = Math.min(room, Math.max(0, (t0 - ha) * 0.9));
        }
        reach.get(a)[side] = room;
      }
    }
    const grown = [], newBoxes = [];
    const H = img.rows, W = img.cols;
    for (const [a, [, , v, , ha]] of frame) {
      const [up, down] = reach.get(a);
      if (up <= 0 && down <= 0) continue;
      const b = boxes[a].map((p) => [...p]);
      if (up > 0) for (const i of [0, 1]) { b[i][0] -= v[0] * (up + mc.margin * ha); b[i][1] -= v[1] * (up + mc.margin * ha); }
      if (down > 0) for (const i of [2, 3]) { b[i][0] += v[0] * (down + mc.margin * ha); b[i][1] += v[1] * (down + mc.margin * ha); }
      grown.push(a);
      newBoxes.push(boxF32(b.map(([x, y]) => [clip(x, 0, W - 1), clip(y, 0, H - 1)])));
    }
    const done = new Set();
    const reads = newBoxes.length ? await this._readBoxes(img, newBoxes) : [];
    grown.forEach((a, k) => {
      const r = reads[k];
      const nw = fixScripts(canonical(r[0]));
      if (this._dropReason(nw, r[1]) !== null) return;
      const old = fixScripts(canonical(rec[a][0]));
      if (mc.keep_base && (floating ? digitsOf(nw) !== digitsOf(old) : baseOf(nw) !== baseOf(old))) return;
      boxes[a] = newBoxes[k]; rec[a] = [r[0], r[1]]; page.chars[a] = r[2];
      done.add(a);
    });
    return new Set([...owner].filter(([, a]) => done.has(a)).map(([j]) => j));
  }

  _join(rows, geom = null, hline = 1) {
    const jc = this.cfg.join;
    if (jc.paragraphs && geom && geom.length === rows.length && !jc.thai_no_space) {
      const out = [];
      let prev = null;
      rows.forEach((r, i) => {
        const g = geom[i];
        if (out.length && prev && g && (g[0] - prev[1] > jc.paragraph_gap * hline || g[1] < prev[0])) out.push("");
        out.push(r);
        prev = g || prev;
      });
      return out.join("\n");
    }
    if (!jc.thai_no_space) return rows.join("\n");
    let out = rows.length ? rows[0] : "";
    for (const r of rows.slice(1)) out += (out && isThai(out[out.length - 1]) && isThai(r[0]) ? "" : "\n") + r;
    return out;
  }

  async dispose() {
    for (const s of [this.det, this.rec, this.rec2]) if (s) await s.release?.();
  }
}

/** PostProcess block of a PaddleX inference.yml: flat `key: value` pairs (the runtime's _yaml_postprocess). */
function parsePostprocess(text) {
  const out = {};
  let inPost = false;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("PostProcess:")) { inPost = true; continue; }
    if (inPost && raw && !raw.startsWith(" ")) break;
    if (!inPost) continue;
    const line = raw.trim();
    const k = line.indexOf(":");
    if (k < 0) continue;
    const key = line.slice(0, k).trim(), v = line.slice(k + 1).trim();
    const num = Number(v);
    out[key] = v !== "" && !Number.isNaN(num) ? num : v;
  }
  return out;
}
