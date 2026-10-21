const $ = (selector) => document.querySelector(selector);
const state = {
  image: null,
  imageName: "drawing",
  width: 0,
  height: 0,
  source: null,
  components: [],
  componentMap: null,
  stepCount: 8,
  currentStep: 0,
  viewMode: "cumulative",
};

const canvas = $("#canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

function setStatus(message) { $("#status").textContent = message; }
function safeName() { return state.imageName.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-") || "drawing"; }
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function saveBlob(blob, filename, description, extensions) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description,
          accept: { [blob.type || "application/octet-stream"]: extensions },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      setStatus(`Đã lưu ${handle.name}.`);
      return true;
    } catch (error) {
      if (error?.name === "AbortError") { setStatus("Đã hủy lưu file."); return false; }
      console.warn("Save picker unavailable; using browser download.", error);
    }
  }
  download(blob, filename);
  setStatus(`Đã tải ${filename} vào thư mục tải xuống mặc định của trình duyệt.`);
  return true;
}

async function writeFilesToChosenDirectory(files) {
  if (!window.showDirectoryPicker) return false;
  try {
    const directory = await window.showDirectoryPicker({ mode: "readwrite" });
    for (const file of files) {
      const handle = await directory.getFileHandle(file.name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(file.blob);
      await writable.close();
    }
    setStatus(`Đã lưu ${files.length} file vào thư mục “${directory.name}”.`);
    return true;
  } catch (error) {
    if (error?.name === "AbortError") { setStatus("Đã hủy chọn thư mục."); return null; }
    console.warn("Directory picker unavailable; using browser downloads.", error);
    return false;
  }
}

function loadImageFile(file) {
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    const maxSide = 1200;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    state.width = Math.max(1, Math.round(img.naturalWidth * scale));
    state.height = Math.max(1, Math.round(img.naturalHeight * scale));
    state.image = img;
    state.imageName = file.name || "sample-lineart.png";
    canvas.width = state.width;
    canvas.height = state.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, state.width, state.height);
    state.source = ctx.getImageData(0, 0, state.width, state.height);
    state.components = [];
    state.componentMap = null;
    $("#canvasShell").classList.remove("empty");
    $("#emptyState").hidden = true;
    $("#analyze").disabled = false;
    $("#imageInfo").textContent = `${img.naturalWidth} × ${img.naturalHeight}px · xử lý ở ${state.width} × ${state.height}px`;
    setStatus("Ảnh đã tải. Bấm “Phân tích nét”.");
    updateControls();
  };
  img.src = URL.createObjectURL(file);
}

async function loadSample() {
  const response = await fetch("sample/three-girls-lineart.png");
  const blob = await response.blob();
  loadImageFile(new File([blob], "three-girls-lineart.png", { type: blob.type }));
}

function analyze() {
  if (!state.source) return;
  setStatus("Đang nhận diện các cụm nét…");
  requestAnimationFrame(() => {
    const { width: w, height: h, data } = state.source;
    const threshold = Number($("#threshold").value);
    const minSize = Number($("#minSize").value);
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) {
      const j = i * 4;
      const alpha = data[j + 3];
      const luminance = .2126 * data[j] + .7152 * data[j + 1] + .0722 * data[j + 2];
      mask[i] = alpha > 16 && luminance < threshold ? 1 : 0;
    }

    const map = new Int32Array(w * h); map.fill(-1);
    const queue = new Int32Array(w * h);
    const found = [];
    const neighbors = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || map[start] !== -1) continue;
      const provisional = found.length;
      let head = 0, tail = 0;
      queue[tail++] = start; map[start] = provisional;
      const pixels = [];
      let minX = w, minY = h, maxX = 0, maxY = 0;
      while (head < tail) {
        const p = queue[head++]; pixels.push(p);
        const x = p % w, y = (p / w) | 0;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        for (const [dx, dy] of neighbors) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const np = ny * w + nx;
          if (mask[np] && map[np] === -1) { map[np] = provisional; queue[tail++] = np; }
        }
      }
      found.push({ pixels, minX, minY, maxX, maxY, step: 0 });
    }

    const kept = found.filter(c => c.pixels.length >= minSize);
    const remap = new Int32Array(found.length); remap.fill(-1);
    kept.forEach((component, id) => {
      remap[found.indexOf(component)] = id;
      component.id = id;
      component.step = 0;
    });
    for (let i = 0; i < map.length; i++) map[i] = map[i] < 0 ? -1 : remap[map[i]];
    state.components = kept;
    state.componentMap = map;
    autoSplit();
    updateControls();
    setStatus(`Đã tìm thấy ${kept.length} cụm nét liền mạch. Chọn step và bấm vào hình để chỉnh.`);
  });
}

function autoSplit() {
  if (!state.components.length) return;
  state.stepCount = Number($("#stepCount").value);
  // Prefer long, sparse shapes first: they tend to describe the main construction
  // better than small dense details such as eyes, fabric marks and accessories.
  const metrics = component => {
    const width = component.maxX - component.minX + 1;
    const height = component.maxY - component.minY + 1;
    const boxArea = width * height;
    const density = component.pixels.length / boxArea;
    return {
      structure: Math.hypot(width, height) * (1.15 - Math.min(.95, density)),
      cost: Math.sqrt(component.pixels.length) + Math.hypot(width, height) * .018 + 5,
    };
  };
  const ranked = [...state.components].sort((a, b) => {
    const ma = metrics(a), mb = metrics(b);
    return mb.structure - ma.structure || mb.cost - ma.cost;
  });

  // A rising curve reserves few components for the first step and increasingly
  // more for later steps. As stepCount grows, step 1's share becomes smaller.
  const weights = Array.from({length: state.stepCount}, (_, i) => Math.pow(i + 1, 1.7));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const allocation = Array(state.stepCount).fill(0);
  const guaranteedSteps = Math.min(state.stepCount, ranked.length);
  for (let i = 0; i < guaranteedSteps; i++) allocation[i] = 1;
  let remaining = ranked.length - guaranteedSteps;
  const exact = weights.map(weight => remaining * weight / totalWeight);
  exact.forEach((share, i) => { const whole = Math.floor(share); allocation[i] += whole; remaining -= whole; });
  const remainderOrder = exact.map((share, i) => ({i, fraction: share - Math.floor(share)}))
    .sort((a, b) => b.fraction - a.fraction || b.i - a.i);
  for (let i = 0; i < remaining; i++) allocation[remainderOrder[i % remainderOrder.length].i]++;

  let cursor = 0;
  allocation.forEach((count, step) => {
    for (let i = 0; i < count && cursor < ranked.length; i++) ranked[cursor++].step = step;
  });
  state.currentStep = Math.min(state.currentStep, state.stepCount - 1);
  renderTabs(); render(); updateControls();
}

function componentColor(id, component) {
  if (state.viewMode === "components") return `hsl(${(id * 67) % 360} 72% 46%)`;
  if (component.step === state.currentStep) return "#ff5d55";
  if (state.viewMode === "cumulative" && component.step < state.currentStep) return "#a9abb2";
  return null;
}

function renderTo(targetCtx, step, mode = state.viewMode, exportMode = false) {
  const w = state.width, h = state.height;
  targetCtx.clearRect(0, 0, w, h);
  const image = targetCtx.createImageData(w, h);
  const out = image.data;
  for (let id = 0; id < state.components.length; id++) {
    const c = state.components[id];
    let color = null;
    if (exportMode) color = c.step <= step ? [0,0,0,255] : null;
    else if (mode === "components") {
      const hue = (id * 67) % 360;
      color = hslToRgb(hue / 360, .72, .46).concat(255);
    } else if (c.step === step) color = [255,93,85,255];
    else if (mode === "cumulative" && c.step < step) color = [169,171,178,255];
    if (!color) continue;
    for (const p of c.pixels) {
      const j = p * 4; out[j] = color[0]; out[j+1] = color[1]; out[j+2] = color[2]; out[j+3] = color[3];
    }
  }
  targetCtx.putImageData(image, 0, 0);
}

function render() {
  if (!state.components.length) return;
  renderTo(ctx, state.currentStep);
  $("#stepTitle").textContent = `Bước ${state.currentStep + 1} / ${state.stepCount}`;
  renderTabs();
}

function renderTabs() {
  const host = $("#stepTabs"); host.innerHTML = "";
  if (!state.components.length) return;
  for (let s = 0; s < state.stepCount; s++) {
    const count = state.components.filter(c => c.step === s).length;
    const button = document.createElement("button");
    button.className = `step-tab${s === state.currentStep ? " active" : ""}`;
    button.innerHTML = `<strong>Bước ${s + 1}</strong><small>${count} cụm nét</small>`;
    button.onclick = () => { state.currentStep = s; render(); updateControls(); };
    host.appendChild(button);
  }
}

function selectComponent(event) {
  if (!state.componentMap) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(state.width - 1, Math.floor((event.clientX - rect.left) * state.width / rect.width)));
  const y = Math.max(0, Math.min(state.height - 1, Math.floor((event.clientY - rect.top) * state.height / rect.height)));
  let id = state.componentMap[y * state.width + x];
  if (id < 0) {
    for (let radius = 1; radius <= 8 && id < 0; radius++) {
      for (let dy = -radius; dy <= radius && id < 0; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < state.width && ny >= 0 && ny < state.height) {
          const candidate = state.componentMap[ny * state.width + nx];
          if (candidate >= 0) { id = candidate; break; }
        }
      }
    }
  }
  if (id >= 0) {
    state.components[id].step = state.currentStep;
    render();
    setStatus(`Đã chuyển cụm nét #${id + 1} vào bước ${state.currentStep + 1}.`);
  }
}

function svgPathForComponent(component) {
  const rows = new Map();
  for (const p of component.pixels) {
    const x = p % state.width, y = (p / state.width) | 0;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(x);
  }
  let d = "";
  for (const [y, xs] of [...rows.entries()].sort((a,b) => a[0]-b[0])) {
    xs.sort((a,b) => a-b);
    let start = xs[0], prev = xs[0];
    for (let i = 1; i <= xs.length; i++) {
      const x = xs[i];
      if (i === xs.length || x > prev + 1) {
        d += `M${start} ${y}h${prev-start+1}v1H${start}z`;
        start = x;
      }
      prev = x;
    }
  }
  return d;
}

async function exportSvg() {
  const groups = Array.from({length: state.stepCount}, (_, step) => {
    const paths = state.components.filter(c => c.step === step)
      .map(c => `    <path data-component="${c.id}" d="${svgPathForComponent(c)}"/>`).join("\n");
    return `  <g id="step-${String(step + 1).padStart(2,"0")}" fill="#000">\n${paths}\n  </g>`;
  }).join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${state.width} ${state.height}" width="${state.width}" height="${state.height}">\n${groups}\n</svg>`;
  await saveBlob(new Blob([svg], {type:"image/svg+xml"}), `${safeName()}-master.svg`, "SVG image", [".svg"]);
}

function buildStepSvg(step) {
  const paths = state.components.filter(component => component.step === step)
    .map(component => `    <path data-component="${component.id}" d="${svgPathForComponent(component)}"/>`)
    .join("\n");
  const stepId = `step-${String(step + 1).padStart(2,"0")}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${state.width} ${state.height}" width="${state.width}" height="${state.height}">\n  <title>${stepId}</title>\n  <g id="${stepId}" fill="#000">\n${paths}\n  </g>\n</svg>`;
}

async function exportStepSvg(step = state.currentStep) {
  const svg = buildStepSvg(step);
  await saveBlob(
    new Blob([svg], {type:"image/svg+xml"}),
    `${safeName()}-step-${String(step + 1).padStart(2,"0")}.svg`,
    "SVG image",
    [".svg"],
  );
}

async function exportAllSvg() {
  const files = Array.from({length: state.stepCount}, (_, step) => ({
    name: `${safeName()}-step-${String(step + 1).padStart(2,"0")}.svg`,
    blob: new Blob([buildStepSvg(step)], {type:"image/svg+xml"}),
  }));
  const directoryResult = await writeFilesToChosenDirectory(files);
  if (directoryResult !== false) return;
  setStatus("Trình duyệt không hỗ trợ chọn thư mục; đang tải từng SVG.");
  for (const file of files) { download(file.blob, file.name); await new Promise(resolve => setTimeout(resolve, 180)); }
  setStatus(`Đã tải ${files.length} SVG vào thư mục tải xuống mặc định.`);
}

async function exportJson() {
  const json = {
    version: 1,
    source: state.imageName,
    canvas: { width: state.width, height: state.height, viewBox: `0 0 ${state.width} ${state.height}` },
    steps: Array.from({length: state.stepCount}, (_, step) => ({
      id: step + 1,
      groupId: `step-${String(step + 1).padStart(2,"0")}`,
      components: state.components.filter(c => c.step === step).map(c => c.id),
    })),
  };
  await saveBlob(new Blob([JSON.stringify(json, null, 2)], {type:"application/json"}), `${safeName()}-steps.json`, "JSON data", [".json"]);
}

function stepPngBlob(step) {
  return new Promise(resolve => {
    const off = document.createElement("canvas"); off.width = state.width; off.height = state.height;
    renderTo(off.getContext("2d"), step, "cumulative", true);
    off.toBlob(resolve, "image/png");
  });
}

async function exportPng(step = state.currentStep) {
  const blob = await stepPngBlob(step);
  await saveBlob(blob, `${safeName()}-step-${String(step + 1).padStart(2,"0")}.png`, "PNG image", [".png"]);
}
async function exportAll() {
  setStatus("Đang chuẩn bị các PNG…");
  const files = [];
  for (let step = 0; step < state.stepCount; step++) {
    files.push({
      name: `${safeName()}-step-${String(step + 1).padStart(2,"0")}.png`,
      blob: await stepPngBlob(step),
    });
  }
  const directoryResult = await writeFilesToChosenDirectory(files);
  if (directoryResult !== false) return;
  setStatus("Trình duyệt không hỗ trợ chọn thư mục; đang tải từng PNG.");
  for (const file of files) { download(file.blob, file.name); await new Promise(resolve => setTimeout(resolve, 180)); }
  setStatus(`Đã tải ${files.length} PNG vào thư mục tải xuống mặc định.`);
}

function hslToRgb(h, s, l) {
  const hue = (p,q,t) => { if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p; };
  if (!s) return [l*255,l*255,l*255].map(Math.round);
  const q = l < .5 ? l*(1+s) : l+s-l*s, p = 2*l-q;
  return [hue(p,q,h+1/3),hue(p,q,h),hue(p,q,h-1/3)].map(v=>Math.round(v*255));
}

function updateControls() {
  const ready = state.components.length > 0;
  ["autoSplit","exportSvg","exportJson","exportStepSvg","exportAllSvg","exportPng","exportAll"].forEach(id => $("#"+id).disabled = !ready);
  $("#prevStep").disabled = !ready || state.currentStep === 0;
  $("#nextStep").disabled = !ready || state.currentStep === state.stepCount - 1;
}

function updateSaveSupport() {
  const element = $("#saveSupport");
  const supported = Boolean(window.showSaveFilePicker && window.showDirectoryPicker);
  element.className = `save-support ${supported ? "supported" : "fallback"}`;
  element.textContent = supported
    ? "✓ Có thể chọn file hoặc thư mục lưu trên máy."
    : "Trình duyệt này chỉ tải vào Downloads. Mở bằng Chrome/Edge để chọn vị trí lưu.";
}

$("#fileInput").addEventListener("change", e => loadImageFile(e.target.files[0]));
$("#loadSample").addEventListener("click", loadSample);
$("#analyze").addEventListener("click", analyze);
$("#autoSplit").addEventListener("click", () => { autoSplit(); setStatus("Đã chia theo độ khó tăng dần; Step 1 có ngân sách nét nhỏ nhất."); });
$("#threshold").addEventListener("input", e => $("#thresholdValue").value = e.target.value);
$("#minSize").addEventListener("input", e => $("#minSizeValue").value = e.target.value);
$("#stepCount").addEventListener("input", e => { $("#stepCountValue").value = e.target.value; state.stepCount = Number(e.target.value); if(state.components.length) autoSplit(); });
$("#prevStep").addEventListener("click", () => { state.currentStep--; render(); updateControls(); });
$("#nextStep").addEventListener("click", () => { state.currentStep++; render(); updateControls(); });
canvas.addEventListener("click", selectComponent);
document.querySelectorAll(".mode").forEach(button => button.addEventListener("click", () => {
  document.querySelectorAll(".mode").forEach(b => b.classList.remove("active"));
  button.classList.add("active"); state.viewMode = button.dataset.mode; render();
}));
$("#exportSvg").addEventListener("click", exportSvg);
$("#exportJson").addEventListener("click", exportJson);
$("#exportStepSvg").addEventListener("click", () => exportStepSvg());
$("#exportAllSvg").addEventListener("click", exportAllSvg);
$("#exportPng").addEventListener("click", () => exportPng());
$("#exportAll").addEventListener("click", exportAll);

updateControls();
updateSaveSupport();
