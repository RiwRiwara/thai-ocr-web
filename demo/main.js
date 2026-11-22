const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
let worker = null, ready = null, nextId = 1, last = null, fallbackTried = false;
const pending = new Map();

// ---------------------------------------------------------------------------- language (Thai first, English)

const T = {
  th: {
    docTitle: "อ่านข้อความภาษาไทยจากรูป ในเบราว์เซอร์ · thai-ocr-web",
    title: "อ่านข้อความภาษาไทยจากรูป ในเบราว์เซอร์",
    chip1: "🔒 ทำงานในเครื่องคุณ ไม่อัปโหลด", chip2: "⚡ WebGPU หรือ WebAssembly",
    chip3: "✓ ผลตรงกับ runtime ต้นฉบับ", chip4: "ภาษาไทย + English",
    engine: "ประมวลผลด้วย", load: "โหลดโมเดล",
    dropBig: "ลากรูปมาวาง วาง (paste) หรือคลิกเพื่อเลือกไฟล์",
    dropSmall: "PNG หรือ JPG · หน้าเอกสารที่สแกน รูปถ่ายเอกสาร หรือภาพหน้าจอ",
    tryLabel: "หรือลองตัวอย่าง:", s1: "หนังสือราชการ", s2: "ตารางงบประมาณ", s3: "ฟอนต์ไม่มีหัว",
    s4: "2 คอลัมน์", s5: "หน้าเอียง", s6: "กลับหัว",
    image: "รูปภาพ", boxes: "กรอบบรรทัด", text: "ข้อความ", copy: "คัดลอก", copied: "คัดลอกแล้ว",
    empty: "ข้อความจะแสดงที่นี่", linesTitle: "รายบรรทัดและความมั่นใจ",
    colRow: "แถว", colConf: "ความมั่นใจ", colText: "ข้อความ", source: "ซอร์สโค้ด", licenses: "สัญญาอนุญาต",
    footer: 'โมเดล <a href="https://huggingface.co/iapp/OpenThai2.1-OCR-Text-20261118">OpenThai 2.1 OCR Text</a> โดย iApp Technology (Apache-2.0) · หน้านี้เป็นงานพอร์ตเป็น JavaScript โดยอิสระ ไม่ได้เกี่ยวข้องกับ iApp · อ่านได้เฉพาะตัวพิมพ์ ไม่รองรับลายมือและโครงสร้างตาราง',
    idle: "ยังไม่โหลด — โมเดล (6.6 MB) จะโหลดเมื่อเลือกรูป",
    loading: "กำลังโหลดโมเดล…", reading: "กำลังอ่าน…", retrying: "ลองใหม่ด้วย WASM แบบ 1 thread…",
    ready: (b, n, s) => `พร้อมใช้ · ${b} · ${n} thread · โหลดใน ${s} วินาที`,
    done: (s, n, rot) => `เสร็จใน ${s} วินาที · ${n} บรรทัด` + (rot ? ` · หมุนหน้า ${rot}°` : ""),
    loadFail: "โหลดโมเดลไม่สำเร็จ: ", error: "ผิดพลาด: ",
    st: { time: "เวลา", lines: "บรรทัด", conf: "ความมั่นใจเฉลี่ย", backend: "ประมวลผล", image: "ขนาดรูป",
          turned: "หมุนหน้า", straight: "แก้เอียง", dropped: "กรองออก" },
    sec: "วินาที",
  },
  en: {
    docTitle: "Thai OCR in your browser · thai-ocr-web",
    title: "Thai OCR in your browser",
    chip1: "🔒 Runs on your device, nothing uploaded", chip2: "⚡ WebGPU or WebAssembly",
    chip3: "✓ Same output as the reference runtime", chip4: "ภาษาไทย + English",
    engine: "Run on", load: "Load model",
    dropBig: "Drop an image here, paste it, or click to choose",
    dropSmall: "PNG or JPG · a scanned page, a photo of a document, a screenshot",
    tryLabel: "or try a sample:", s1: "Government letter", s2: "Budget table", s3: "Loopless font",
    s4: "Two columns", s5: "Tilted page", s6: "Upside down",
    image: "Image", boxes: "line boxes", text: "Text", copy: "Copy", copied: "Copied",
    empty: "The text will appear here.", linesTitle: "Lines and confidence",
    colRow: "row", colConf: "confidence", colText: "text", source: "Source", licenses: "Licenses",
    footer: 'Model: <a href="https://huggingface.co/iapp/OpenThai2.1-OCR-Text-20261118">OpenThai 2.1 OCR Text</a> by iApp Technology (Apache-2.0) · This page is an unofficial JavaScript port, not affiliated with iApp · Printed text only; handwriting and table structure are not supported',
    idle: "not loaded — the model (6.6 MB) loads when you pick an image",
    loading: "loading model…", reading: "reading…", retrying: "retrying with WASM on one thread…",
    ready: (b, n, s) => `ready · ${b} · ${n} thread(s) · loaded in ${s} s`,
    done: (s, n, rot) => `done in ${s} s · ${n} lines` + (rot ? ` · page turned ${rot}°` : ""),
    loadFail: "could not load the model: ", error: "error: ",
    st: { time: "time", lines: "lines", conf: "mean confidence", backend: "backend", image: "image",
          turned: "turned", straight: "straightened", dropped: "filtered out" },
    sec: "s",
  },
};

let lang = (() => {
  const fromUrl = q.get("lang");
  if (fromUrl === "th" || fromUrl === "en") return fromUrl;
  try { const saved = localStorage.getItem("thai-ocr-web.lang"); if (saved === "th" || saved === "en") return saved; } catch {}
  return "th";
})();
const t = () => T[lang];
let lastStatus = { key: "idle", args: [], state: "" };

function applyLang() {
  document.documentElement.lang = lang;
  document.title = t().docTitle;
  document.querySelectorAll("[data-i18n]").forEach((el) => { const v = t()[el.dataset.i18n]; if (typeof v === "string") el.textContent = v; });
  $("footerText").innerHTML = t().footer;
  $("text").dataset.empty = t().empty;
  document.querySelectorAll('input[name="lang"]').forEach((r) => (r.checked = r.value === lang));
  status(lastStatus.key, lastStatus.args, lastStatus.state);
  if (last?.result) renderStats();
}
document.querySelectorAll('input[name="lang"]').forEach((r) => r.addEventListener("change", () => {
  lang = r.value;
  try { localStorage.setItem("thai-ocr-web.lang", lang); } catch {}
  applyLang();
}));

/** status(key, args, state): the text comes from the language table, so it follows a language switch. */
function status(key, args = [], state = "") {
  lastStatus = { key, args, state };
  const v = t()[key];
  $("status").textContent = typeof v === "function" ? v(...args) : (v ?? "") + (args[0] ?? "");
  $("dot").className = "dot " + state;
}

// ---------------------------------------------------------------------------- backend choice

// radio buttons mirror the hidden #ep select (kept for scripts and tests)
const radios = [...document.querySelectorAll('input[name="backend"]')];
const setBackend = (v) => { $("ep").value = v; radios.forEach((r) => (r.checked = r.value === v)); };
setBackend(q.get("backend") || (navigator.gpu ? "webgpu" : "wasm"));
radios.forEach((r) => r.addEventListener("change", () => {
  if (ready) { // a loaded worker keeps its backend: reload with the new one
    const u = new URL(location.href); u.searchParams.set("backend", r.value); location.href = u; return;
  }
  setBackend(r.value);
}));

// ---------------------------------------------------------------------------- worker

function onMessage({ data }) {
  if (data.type === "ready") {
    status("ready", [data.backend.toUpperCase(), data.threads, (data.ms / 1000).toFixed(1)], "ready");
    setBackend(data.backend);
    ready?.resolve();
  } else if (data.type === "init-error") {
    console.error(data.message);
    if (!fallbackTried) {
      // WebGPU, threads or a large memory can fail on some devices (iOS memory limits, drivers): start over in a
      // fresh worker with the safest setup — WASM, one thread, 320 MB.
      fallbackTried = true;
      status("retrying", [], "busy");
      worker.terminate();
      setBackend("wasm");
      startWorker("wasm", 1, 320);
      return;
    }
    status("loadFail", [data.message.split("\n")[0]], "err");
    ready?.reject(new Error(data.message));
    ready = null; // allow another attempt
    $("load").disabled = false;
  } else if (data.type === "result" || data.type === "error") {
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    data.type === "result" ? p.resolve(data) : p.reject(new Error(data.message.split("\n")[0]));
  }
}

function startWorker(backend, threads, maxMemoryMB) {
  worker = new Worker(new URL("./ocr.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = onMessage;
  worker.postMessage({
    type: "init",
    backend,
    threads,
    maxMemoryMB,
    // a worker's own URL sits under assets/, so resolve the model folder against the page
    modelBaseUrl: new URL(import.meta.env.BASE_URL + "models/", location.href).href,
    wasmManifestUrl: import.meta.env.PROD ? new URL(import.meta.env.BASE_URL + "ort-wasm-manifest.json", location.href).href : undefined,
  });
}

function load() {
  if (ready) return ready.promise;
  status("loading", [], "busy");
  $("load").disabled = true;
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  ready = { promise, resolve, reject };
  startWorker($("ep").value, Number(q.get("threads")) || Math.min(4, navigator.hardwareConcurrency || 1),
    Number(q.get("mem")) || undefined);
  return promise;
}

/** OCR one ImageData. Exposed on window for scripting/tests. */
async function readImage(image) {
  await load();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ type: "read", id, image });
  });
}
window.thaiOCR = { load, readImage };

// ---------------------------------------------------------------------------- page

function draw() {
  if (!last) return;
  const { bmp, result } = last;
  const cv = $("view"), ctx = cv.getContext("2d");
  cv.width = bmp.width; cv.height = bmp.height;
  ctx.drawImage(bmp, 0, 0);
  if (!$("showBoxes").checked || !result) return;
  ctx.lineWidth = Math.max(1.5, bmp.width / 500);
  for (const l of result.lines) {
    const low = l.confidence < 0.9;
    ctx.strokeStyle = low ? "#dc2626" : "#2563eb";
    ctx.fillStyle = low ? "rgba(220,38,38,.08)" : "rgba(37,99,235,.07)";
    ctx.beginPath();
    l.box.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
}

function renderStats() {
  const { bmp, result, ms } = last;
  const s = t().st;
  const conf = result.lines.length ? result.lines.reduce((a, l) => a + l.confidence, 0) / result.lines.length : 0;
  const stats = [
    [s.time, `${(ms / 1000).toFixed(2)} ${t().sec}`], [s.lines, result.lines.length], [s.conf, conf.toFixed(3)],
    [s.backend, $("ep").value.toUpperCase()], [s.image, `${bmp.width}×${bmp.height}`],
  ];
  if (result.rotation) stats.push([s.turned, `${result.rotation}°`]);
  if (Math.abs(result.text_angle) >= 0.5) stats.push([s.straight, `${result.text_angle}°`]);
  if (result.dropped.length) stats.push([s.dropped, result.dropped.length]);
  $("stats").innerHTML = stats.map(([k, v]) => `<span class="stat">${k} <b>${v}</b></span>`).join("");
  $("stats").hidden = false;
}

// Phone photos can be 12+ megapixels; the detector works at 1280 px anyway, and full-size crops cost memory
// a phone may not have. Pages up to this size are read as they are.
const MAX_SIDE = 3200;

async function run(blob, name = "page") {
  let bmp = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  if (scale < 1) {
    bmp = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * scale), resizeHeight: Math.round(bmp.height * scale), resizeQuality: "high" });
  }
  last = { bmp, result: null, name };
  draw();
  $("text").textContent = "";
  const cv = Object.assign(document.createElement("canvas"), { width: bmp.width, height: bmp.height });
  const ctx = cv.getContext("2d");
  ctx.drawImage(bmp, 0, 0);
  const image = ctx.getImageData(0, 0, bmp.width, bmp.height);
  await load();
  status("reading", [], "busy");
  const { result, ms } = await readImage(image);
  Object.assign(last, { result, ms });
  draw();
  status("done", [(ms / 1000).toFixed(2), result.lines.length, result.rotation], "ready");
  $("text").textContent = result.text;
  renderStats();
  const tbody = $("lines").querySelector("tbody");
  tbody.innerHTML = "";
  result.lines.forEach((l, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="num">${i + 1}</td><td class="num">${l.row}</td><td class="num ${l.confidence < 0.9 ? "low" : ""}">${l.confidence.toFixed(3)}</td><td></td>`;
    tr.lastChild.textContent = l.text;
    tbody.appendChild(tr);
  });
}

const fail = (e) => { status("error", [e.message || String(e)], "err"); console.error(e); };
const pick = (f) => f && run(f, f.name.replace(/\.[^.]+$/, "")).catch(fail);
$("load").onclick = () => load().catch(fail);
$("drop").onclick = (e) => { if (!e.target.closest("button")) $("file").click(); };
$("drop").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") $("file").click(); };
$("file").onchange = (e) => pick(e.target.files[0]);
$("drop").ondragover = (e) => { e.preventDefault(); $("drop").classList.add("over"); };
$("drop").ondragleave = () => $("drop").classList.remove("over");
$("drop").ondrop = (e) => { e.preventDefault(); $("drop").classList.remove("over"); pick(e.dataTransfer.files[0]); };
window.onpaste = (e) => pick([...e.clipboardData.files][0]);
$("samples").querySelectorAll("button[data-sample]").forEach((b) => (b.onclick = async () => {
  const name = b.dataset.sample;
  const res = await fetch(new URL(import.meta.env.BASE_URL + `samples/${name}.png`, location.href));
  run(await res.blob(), name).catch(fail);
}));
$("showBoxes").onchange = draw;
$("copy").onclick = async () => {
  await navigator.clipboard.writeText($("text").textContent);
  $("copy").textContent = t().copied; setTimeout(() => ($("copy").textContent = t().copy), 1200);
};
$("download").onclick = () => {
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([$("text").textContent], { type: "text/plain;charset=utf-8" })),
    download: `${last?.name || "ocr"}.txt`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

applyLang();
