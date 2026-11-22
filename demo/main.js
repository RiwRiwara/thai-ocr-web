const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
let worker = null;
let ready = null, nextId = 1, last = null;
const pending = new Map();

// ---- backend choice: radio buttons mirror the hidden #ep select (kept for scripts and tests)
const radios = [...document.querySelectorAll('input[name="backend"]')];
const setBackend = (v) => { $("ep").value = v; radios.forEach((r) => (r.checked = r.value === v)); };
setBackend(q.get("backend") || (navigator.gpu ? "webgpu" : "wasm"));
radios.forEach((r) => r.addEventListener("change", () => {
  if (ready) { location.search = `?backend=${r.value}`; return; } // a loaded worker keeps its backend: reload
  setBackend(r.value);
}));

function status(text, state = "") {
  $("status").textContent = text;
  $("dot").className = "dot " + state;
}

function onMessage({ data }) {
  if (data.type === "ready") {
    status(`ready · ${data.backend.toUpperCase()} · ${data.threads} thread(s) · loaded in ${(data.ms / 1000).toFixed(1)} s`, "ready");
    setBackend(data.backend);
    ready?.resolve();
  } else if (data.type === "init-error") {
    console.error(data.message);
    if (!fallbackTried) {
      // WebGPU or multi-threaded WASM can fail on some devices (memory limits, drivers):
      // start over in a fresh worker with the safest setup, WASM on one thread.
      fallbackTried = true;
      status("retrying with WASM on one thread…", "busy");
      worker.terminate();
      setBackend("wasm");
      startWorker("wasm", 1);
      return;
    }
    status("could not load the model: " + data.message.split("\n")[0], "err");
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

let fallbackTried = false;
function startWorker(backend, threads) {
  worker = new Worker(new URL("./ocr.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = onMessage;
  worker.postMessage({
    type: "init",
    backend,
    threads,
    // a worker's own URL sits under assets/, so resolve the model folder against the page
    modelBaseUrl: new URL(import.meta.env.BASE_URL + "models/", location.href).href,
    wasmManifestUrl: import.meta.env.PROD ? new URL(import.meta.env.BASE_URL + "ort-wasm-manifest.json", location.href).href : undefined,
  });
}

function load() {
  if (ready) return ready.promise;
  status("loading model…", "busy");
  $("load").disabled = true;
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  ready = { promise, resolve, reject };
  startWorker($("ep").value, Number(q.get("threads")) || Math.min(4, navigator.hardwareConcurrency || 1));
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

function draw() {
  if (!last) return;
  const { bmp, result } = last;
  const cv = $("view"), ctx = cv.getContext("2d");
  cv.width = bmp.width; cv.height = bmp.height;
  ctx.drawImage(bmp, 0, 0);
  if (!$("showBoxes").checked || !result) return;
  ctx.lineWidth = Math.max(1.5, bmp.width / 500);
  for (const l of result.lines) {
    ctx.strokeStyle = l.confidence < 0.9 ? "#dc2626" : "#0d9488";
    ctx.fillStyle = l.confidence < 0.9 ? "rgba(220,38,38,.08)" : "rgba(13,148,136,.08)";
    ctx.beginPath();
    l.box.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
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
  const wasReady = !!ready;
  if (!wasReady) status("loading model…", "busy");
  await load();
  status("reading…", "busy");
  const { result, ms } = await readImage(image);
  last.result = result;
  draw();
  status(`done in ${(ms / 1000).toFixed(2)} s · ${result.lines.length} lines` + (result.rotation ? ` · page turned ${result.rotation}°` : ""), "ready");
  $("text").textContent = result.text;
  const conf = result.lines.length ? result.lines.reduce((s, l) => s + l.confidence, 0) / result.lines.length : 0;
  const stats = [
    ["time", `${(ms / 1000).toFixed(2)} s`], ["lines", result.lines.length], ["mean confidence", conf.toFixed(3)],
    ["backend", $("ep").value.toUpperCase()], ["image", `${bmp.width}×${bmp.height}`],
  ];
  if (result.rotation) stats.push(["turned", `${result.rotation}°`]);
  if (Math.abs(result.text_angle) >= 0.5) stats.push(["straightened", `${result.text_angle}°`]);
  if (result.dropped.length) stats.push(["filtered out", result.dropped.length]);
  $("stats").innerHTML = stats.map(([k, v]) => `<span class="stat">${k} <b>${v}</b></span>`).join("");
  $("stats").hidden = false;
  const tbody = $("lines").querySelector("tbody");
  tbody.innerHTML = "";
  result.lines.forEach((l, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="num">${i + 1}</td><td class="num">${l.row}</td><td class="num ${l.confidence < 0.9 ? "low" : ""}">${l.confidence.toFixed(3)}</td><td></td>`;
    tr.lastChild.textContent = l.text;
    tbody.appendChild(tr);
  });
}

const fail = (e) => { status("error: " + (e.message || e), "err"); console.error(e); };
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
  $("copy").textContent = "Copied"; setTimeout(() => ($("copy").textContent = "Copy"), 1200);
};
$("download").onclick = () => {
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([$("text").textContent], { type: "text/plain;charset=utf-8" })),
    download: `${last?.name || "ocr"}.txt`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
