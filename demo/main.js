const $ = (id) => document.getElementById(id);
const worker = new Worker(new URL("./ocr.worker.js", import.meta.url), { type: "module" });
let ready = null, nextId = 1;
const pending = new Map();

worker.onmessage = ({ data }) => {
  if (data.type === "ready") {
    $("status").textContent = `ready · ${data.backend.toUpperCase()} · ${data.threads} thread(s) · loaded in ${(data.ms / 1000).toFixed(1)} s`;
    ready?.resolve();
  } else if (data.type === "result" || data.type === "error") {
    const p = pending.get(data.id);
    if (!p) { if (data.type === "error") { $("status").textContent = "error: " + data.message; ready?.reject(data.message); } return; }
    pending.delete(data.id);
    data.type === "result" ? p.resolve(data) : p.reject(new Error(data.message));
  }
};

function load() {
  if (ready) return ready.promise;
  $("status").textContent = "loading model…";
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  ready = { promise, resolve, reject };
  const q = new URLSearchParams(location.search);
  worker.postMessage({
    type: "init",
    backend: q.get("backend") || $("ep").value,
    threads: Number(q.get("threads")) || Math.min(4, navigator.hardwareConcurrency || 1),
    // a worker's own URL sits under assets/, so resolve the model folder against the page
    modelBaseUrl: new URL(import.meta.env.BASE_URL + "models/", location.href).href,
  });
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

async function run(file) {
  const bmp = await createImageBitmap(file);
  const cv = $("view");
  cv.width = bmp.width; cv.height = bmp.height;
  const ctx = cv.getContext("2d");
  ctx.drawImage(bmp, 0, 0);
  const image = ctx.getImageData(0, 0, bmp.width, bmp.height);
  $("status").textContent = "reading…";
  const { result, ms } = await readImage(image);
  $("status").textContent = `done in ${(ms / 1000).toFixed(2)} s · ${result.lines.length} lines` + (result.rotation ? ` · page turned ${result.rotation}°` : "");
  $("text").textContent = result.text;
  ctx.lineWidth = Math.max(1, bmp.width / 600);
  const tbody = $("lines").querySelector("tbody");
  tbody.innerHTML = "";
  result.lines.forEach((l, i) => {
    ctx.strokeStyle = l.confidence < 0.9 ? "#e33" : "#2a7";
    ctx.beginPath();
    l.box.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath(); ctx.stroke();
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${i + 1}</td><td>${l.row}</td><td class="${l.confidence < 0.9 ? "low" : ""}">${l.confidence.toFixed(3)}</td><td></td>`;
    tr.lastChild.textContent = l.text;
    tbody.appendChild(tr);
  });
}

const fail = (e) => { $("status").textContent = "error: " + (e.message || e); console.error(e); };
$("load").onclick = () => load().catch(fail);
$("drop").onclick = () => $("file").click();
$("file").onchange = (e) => e.target.files[0] && run(e.target.files[0]).catch(fail);
$("drop").ondragover = (e) => { e.preventDefault(); $("drop").classList.add("over"); };
$("drop").ondragleave = () => $("drop").classList.remove("over");
$("drop").ondrop = (e) => { e.preventDefault(); $("drop").classList.remove("over"); e.dataTransfer.files[0] && run(e.dataTransfer.files[0]).catch(fail); };
window.onpaste = (e) => { const f = [...e.clipboardData.files][0]; if (f) run(f).catch(fail); };
$("copy").onclick = () => navigator.clipboard.writeText($("text").textContent);
