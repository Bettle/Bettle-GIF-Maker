(function () {
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const frameList = document.getElementById("frameList");

  const frameDelay = document.getElementById("frameDelay");
  const frameDelayValue = document.getElementById("frameDelayValue");
  const colourReduction = document.getElementById("colourReduction");
  const ditherMode = document.getElementById("ditherMode");
  const ditherStrength = document.getElementById("ditherStrength");
  const loopCount = document.getElementById("loopCount");
  const outWidth = document.getElementById("outWidth");
  const outHeight = document.getElementById("outHeight");
  const fileName = document.getElementById("fileName");
  const makeGifBtn = document.getElementById("makeGifBtn");

  const previewContent = document.getElementById("previewContent");
  const previewImg = document.getElementById("previewImg");
  const downloadBtn = document.getElementById("downloadBtn");

  const statusText = document.getElementById("statusText");
  const progressTrack = document.getElementById("progressTrack");
  const progressFill = document.getElementById("progressFill");

  let sources = [];

  // ---- status / progress helpers ----
  function setStatus(text) { statusText.textContent = text; }
  function setProgress(pct) {
    if (pct === null) { progressTrack.hidden = true; return; }
    progressTrack.hidden = false;
    progressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  // ---- drag & drop wiring ----
  dropZone.addEventListener("click", (e) => {
    if (e.target.closest(".frame-list")) return;
    fileInput.click();
  });
  dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) handleFiles(fileInput.files);
    fileInput.value = "";
  });

  async function handleFiles(fileList) {
    try {
      setStatus("Loading files…");
      makeGifBtn.disabled = true;
      const loaded = await FileLoader.loadFiles(fileList);
      if (loaded.length === 0) {
        setStatus("No supported PDF/PNG/JPG files found");
        return;
      }
      const isPdf = Array.from(fileList).some((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
      const withSelection = loaded.map((s) => ({ ...s, isSelected: true }));
      sources = isPdf || sources.length === 0 ? withSelection : sources.concat(withSelection);

      outWidth.value = sources[0].nativeWidth;
      outHeight.value = sources[0].nativeHeight;

      await renderFrameList();
      updateMakeGifState();
      setStatus(`${sources.length} frame${sources.length > 1 ? "s" : ""} loaded — ready`);
    } catch (err) {
      console.error(err);
      setStatus(`Couldn't load file: ${err.message || err}`);
    }
  }

  function selectedSources() {
    return sources.filter((s) => s.isSelected);
  }

  function updateMakeGifState() {
    makeGifBtn.disabled = selectedSources().length === 0;
  }

  async function renderFrameList() {
    frameList.innerHTML = "";
    frameList.hidden = false;
    document.querySelector(".drop-content").style.display = "none";

    const header = document.createElement("div");
    header.className = "frame-list-header";
    header.innerHTML = `
      <span class="frame-count">${sources.length} frame${sources.length > 1 ? "s" : ""}</span>
      <div class="frame-list-actions">
        <button type="button" class="icon-btn" id="addFramesBtn" title="Add frames" aria-label="Add frames">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>
        </button>
        <button type="button" class="icon-btn" id="clearFramesBtn" title="Clear all" aria-label="Clear all frames">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>
        </button>
      </div>
    `;
    frameList.appendChild(header);

    header.querySelector("#addFramesBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      fileInput.click();
    });
    header.querySelector("#clearFramesBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      sources = [];
      frameList.hidden = true;
      frameList.innerHTML = "";
      document.querySelector(".drop-content").style.display = "";
      makeGifBtn.disabled = true;
      setStatus("Ready");
    });

    const grid = document.createElement("div");
    grid.className = "frame-grid";
    frameList.appendChild(grid);

    for (const src of sources) {
      if (!src.thumbUrl) src.thumbUrl = await src.thumbnail(160);

      const item = document.createElement("div");
      item.className = "frame-item" + (src.isSelected ? " selected" : "");
      item.innerHTML = `
        <div class="frame-thumb-wrap">
          <img src="${src.thumbUrl}" alt="">
          <span class="frame-toggle">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <circle class="toggle-ring" cx="12" cy="12" r="10"/>
              <path class="toggle-check" d="M7 12.5l3 3 7-7"/>
            </svg>
          </span>
        </div>
        <span class="frame-name">${src.name}</span>
      `;
      item.addEventListener("click", () => {
        src.isSelected = !src.isSelected;
        item.classList.toggle("selected", src.isSelected);
        updateMakeGifState();
      });
      grid.appendChild(item);
    }
  }

  // ---- settings display wiring ----
  frameDelay.addEventListener("input", () => {
    frameDelayValue.textContent = `${parseFloat(frameDelay.value).toFixed(1)}s`;
  });
  ditherStrength.addEventListener("change", () => {
    const v = Math.max(0, Math.min(100, Number(ditherStrength.value) || 0));
    ditherStrength.value = v;
  });

  // ---- worker pool: parallel, batched frame dithering ----
  function ditherFramesInPool(frames, palette, mode, strength, onProgress) {
    return new Promise((resolve, reject) => {
      if (frames.length === 0) { resolve([]); return; }

      const results = new Array(frames.length);
      const poolSize = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 6, frames.length));
      const workers = Array.from({ length: poolSize }, () => new Worker("js/frame-worker.js"));
      let nextIndex = 0;
      let completed = 0;
      let failed = false;

      function assignNext(worker) {
        if (failed) return;
        if (nextIndex >= frames.length) { worker.terminate(); return; }
        const frameId = nextIndex++;
        const frame = frames[frameId];
        worker.postMessage({
          frameId,
          width: frame.width,
          height: frame.height,
          rgba: frame.data,
          palette,
          ditherMode: mode,
          ditherStrength: strength,
        }, [frame.data.buffer]);
      }

      for (const worker of workers) {
        worker.onmessage = (e) => {
          results[e.data.frameId] = e.data.indices;
          completed++;
          onProgress(completed, frames.length);
          if (completed === frames.length) {
            workers.forEach((w) => w.terminate());
            resolve(results);
          } else {
            assignNext(worker);
          }
        };
        worker.onerror = (err) => {
          if (failed) return;
          failed = true;
          workers.forEach((w) => w.terminate());
          reject(err);
        };
        assignNext(worker);
      }
    });
  }

  // ---- Make GIF ----
  makeGifBtn.addEventListener("click", async () => {
    const selected = selectedSources();
    if (selected.length === 0) return;
    const width = Math.max(1, Math.round(Number(outWidth.value)) || selected[0].nativeWidth);
    const height = Math.max(1, Math.round(Number(outHeight.value)) || selected[0].nativeHeight);
    const delayCentiseconds = Math.round(parseFloat(frameDelay.value) * 100);
    const loop = Number(loopCount.value);
    const mode = ditherMode.value;
    const strength = Number(ditherStrength.value);

    makeGifBtn.disabled = true;
    downloadBtn.hidden = true;
    previewImg.hidden = true;
    previewContent.style.display = "";

    try {
      // 1. Rasterise every selected source at the target size (sequential —
      //    PDF.js renders one page at a time against a single document).
      setStatus("Rendering frames…");
      setProgress(0);
      const frames = [];
      for (let i = 0; i < selected.length; i++) {
        frames.push(await selected[i].render(width, height));
        setProgress(((i + 1) / selected.length) * 25);
      }

      // 2. Build one shared palette (computed once, reused for every frame).
      setStatus("Building colour palette…");
      setProgress(30);
      const palette = Quantize.buildPalette(frames, 256);

      // 3. Dither + index each frame in parallel across a worker pool.
      setStatus(`Dithering frames (0/${frames.length})…`);
      const indexedFrames = await ditherFramesInPool(frames, palette, mode, strength, (done, total) => {
        setStatus(`Dithering frames (${done}/${total})…`);
        setProgress(35 + (done / total) * 55);
      });

      // 4. Encode the GIF.
      setStatus("Encoding GIF…");
      setProgress(95);
      const bytes = GifWriter.encode({
        width, height, palette, frames: indexedFrames, delayCentiseconds, loopCount: loop,
      });

      const blob = new Blob([bytes], { type: "image/gif" });
      const url = URL.createObjectURL(blob);

      previewContent.style.display = "none";
      previewImg.src = url;
      previewImg.hidden = false;

      const name = (fileName.value || "gif-export").trim().replace(/\.gif$/i, "");
      downloadBtn.href = url;
      downloadBtn.download = `${name}.gif`;
      downloadBtn.hidden = false;

      setProgress(100);
      setStatus(`Done — ${frames.length} frame${frames.length > 1 ? "s" : ""}, ${(bytes.length / 1024).toFixed(0)} KB`);
      setTimeout(() => setProgress(null), 600);
    } catch (err) {
      console.error(err);
      setStatus(`Failed to build GIF: ${err.message || err}`);
      setProgress(null);
    } finally {
      updateMakeGifState();
    }
  });
})();
