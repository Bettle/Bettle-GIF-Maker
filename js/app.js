(function () {
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const jobQueue = document.getElementById("jobQueue");
  const jobBlocks = document.getElementById("jobBlocks");
  const filenameList = document.getElementById("filenameList");

  const frameDelay = document.getElementById("frameDelay");
  const frameDelayValue = document.getElementById("frameDelayValue");
  const colourReduction = document.getElementById("colourReduction");
  const ditherMode = document.getElementById("ditherMode");
  const ditherStrength = document.getElementById("ditherStrength");
  const loopCount = document.getElementById("loopCount");
  const outWidth = document.getElementById("outWidth");
  const outHeight = document.getElementById("outHeight");
  const makeSelectedBtn = document.getElementById("makeSelectedBtn");
  const makeGifBtn = document.getElementById("makeGifBtn");

  const previewEmpty = document.getElementById("previewEmpty");
  const previewGrid = document.getElementById("previewGrid");
  const downloadAllBtn = document.getElementById("downloadAllBtn");

  const statusText = document.getElementById("statusText");
  const progressTrack = document.getElementById("progressTrack");
  const progressFill = document.getElementById("progressFill");

  let jobs = [];
  let activeJobId = null;
  let jobCounter = 0;
  let fileInputTarget = "newJob"; // "newJob" | "addFrames"
  let isProcessing = false;
  let dragState = null; // { jobId, fromIndex } while a frame is being dragged
  const supportsFSAccess = typeof window.showSaveFilePicker === "function";

  // ---- status / progress helpers ----
  function setStatus(text) { statusText.textContent = text; }
  function setProgress(pct) {
    if (pct === null) { progressTrack.hidden = true; return; }
    progressTrack.hidden = false;
    progressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function sanitizeFileName(name) {
    return ((name || "gif-export").trim().replace(/\.gif$/i, "")) || "gif-export";
  }

  function formatDuration(ms) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function formatFileSize(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  function statusLabel(job) {
    switch (job.status) {
      case "pending": return "Pending";
      case "processing": return "Processing…";
      case "done": return "Done";
      case "error": return "Error";
      default: return "";
    }
  }

  // ---- save-to-disk (File System Access API, with plain-download fallback) ----
  async function promptSaveLocation(job) {
    if (!supportsFSAccess) return;
    try {
      job.saveHandle = await window.showSaveFilePicker({
        suggestedName: `${sanitizeFileName(job.settings.fileName)}.gif`,
        types: [{ description: "GIF image", accept: { "image/gif": [".gif"] } }],
      });
      setStatus(`Save location set for "${job.settings.fileName}"`);
    } catch (err) {
      if (err.name !== "AbortError") console.error(err);
    }
  }

  function syncJobFileName(job) {
    updateFileNameButton(job);
    const row = jobQueue.querySelector(`[data-job-id="${job.id}"] .queue-filename`);
    if (row && document.activeElement !== row) row.value = job.settings.fileName;
    updatePreviewTileName(job);
  }

  async function handleFilenameButtonClick(job) {
    if (supportsFSAccess) {
      await promptSaveLocation(job);
      if (job.saveHandle) {
        job.settings.fileName = sanitizeFileName(job.saveHandle.name);
        syncJobFileName(job);
      }
    } else {
      const newName = prompt("File name", job.settings.fileName);
      if (newName !== null && newName.trim()) {
        job.settings.fileName = newName.trim();
        syncJobFileName(job);
      }
    }
  }

  async function downloadJob(job) {
    if (!job.result) return;
    if (job.saveHandle) {
      try {
        const writable = await job.saveHandle.createWritable();
        await writable.write(job.result.blob);
        await writable.close();
        setStatus(`Saved "${sanitizeFileName(job.settings.fileName)}.gif"`);
      } catch (err) {
        console.error(err);
        setStatus(`Couldn't save file: ${err.message || err}`);
      }
    } else {
      const a = document.createElement("a");
      a.href = job.result.url;
      a.download = `${sanitizeFileName(job.settings.fileName)}.gif`;
      a.click();
    }
  }

  // ---- job model ----
  function deriveDefaultFileName(loadedSources) {
    const first = loadedSources[0];
    if (!first) return "gif-export";
    return first.name
      .replace(/ — page \d+$/i, "")
      .replace(/\.(pdf|png|jpe?g)$/i, "");
  }

  function uniqueFileName(base) {
    let name = base;
    let n = 2;
    while (jobs.some((j) => j.settings.fileName === name)) {
      name = `${base} (${n})`;
      n += 1;
    }
    return name;
  }

  function createJob(loadedSources) {
    jobCounter += 1;
    return {
      id: `job-${Date.now()}-${jobCounter}`,
      sources: loadedSources.map((s) => ({ ...s, isSelected: true })),
      settings: {
        frameDelay: 3.0,
        colourReduction: "selective",
        ditherMode: "diffusion",
        ditherStrength: 100,
        loopCount: 3,
        outWidth: loadedSources[0].nativeWidth,
        outHeight: loadedSources[0].nativeHeight,
        fileName: uniqueFileName(deriveDefaultFileName(loadedSources)),
      },
      status: "pending",
      error: null,
      result: null, // { url, blob, byteLength, frameCount }
      saveHandle: null,
    };
  }

  function getActiveJob() {
    return jobs.find((j) => j.id === activeJobId) || null;
  }

  // ---- drag & drop wiring ----
  dropZone.addEventListener("click", (e) => {
    if (e.target.closest(".job-queue") || e.target.closest(".job-blocks")) return;
    fileInputTarget = "newJob";
    fileInput.click();
  });
  dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files, "newJob");
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) handleFiles(fileInput.files, fileInputTarget);
    fileInput.value = "";
    fileInputTarget = "newJob";
  });

  async function handleFiles(fileList, mode) {
    try {
      if (mode === "addFrames" && !getActiveJob()) mode = "newJob";
      setStatus("Loading files…");
      const loaded = await FileLoader.loadFiles(fileList);
      if (loaded.length === 0) {
        setStatus("No supported PDF/PNG/JPG files found");
        return;
      }

      if (mode === "addFrames") {
        const job = getActiveJob();
        job.sources = job.sources.concat(loaded.map((s) => ({ ...s, isSelected: true })));
        await renderJobBlocks();
        setStatus(`${job.sources.length} frame${job.sources.length > 1 ? "s" : ""} in this job`);
      } else {
        const job = createJob(loaded);
        jobs.push(job);
        activeJobId = job.id;
        renderJobQueue();
        renderFilenameList();
        renderPreviewGrid();
        populateSettingsPanel(job);
        await renderJobBlocks();
        setStatus(`Job added — ${loaded.length} frame${loaded.length > 1 ? "s" : ""}`);
      }
      updateMakeGifState();
      updateMakeSelectedState();
      updateDownloadAllState();
    } catch (err) {
      console.error(err);
      setStatus(`Couldn't load file: ${err.message || err}`);
    }
  }

  function updateMakeGifState() {
    makeGifBtn.disabled = isProcessing || jobs.length === 0;
    makeGifBtn.textContent = jobs.length > 1 ? `Make ${jobs.length} GIFs` : "Make GIF";
  }

  function updateMakeSelectedState() {
    makeSelectedBtn.disabled = isProcessing || !getActiveJob();
  }

  function updateDownloadAllState() {
    downloadAllBtn.hidden = jobs.length === 0;
    downloadAllBtn.disabled = !jobs.some((j) => j.status === "done");
  }

  // ---- active job switching (drives the settings panel only) ----
  function setActiveJob(id) {
    activeJobId = id;
    document.querySelectorAll(".job-block").forEach((b) => b.classList.toggle("active", b.dataset.jobId === id));
    document.querySelectorAll(".job-swatch").forEach((s) => s.classList.toggle("active", s.dataset.jobId === id));
    document.querySelectorAll(".preview-tile").forEach((t) => t.classList.toggle("active", t.dataset.jobId === id));
    updateMakeSelectedState();
    const job = getActiveJob();
    if (!job) return;
    populateSettingsPanel(job);
  }

  function populateSettingsPanel(job) {
    const s = job.settings;
    frameDelay.value = s.frameDelay;
    frameDelayValue.textContent = `${s.frameDelay.toFixed(1)}s`;
    colourReduction.value = s.colourReduction;
    ditherMode.value = s.ditherMode;
    ditherStrength.value = s.ditherStrength;
    loopCount.value = String(s.loopCount);
    outWidth.value = s.outWidth;
    outHeight.value = s.outHeight;
  }

  // ---- compact queue-row list (top of left panel) ----
  function renderJobQueue() {
    const dropContent = document.querySelector(".drop-content");

    if (jobs.length === 0) {
      jobQueue.hidden = true;
      jobQueue.innerHTML = "";
      dropContent.style.display = "";
      return;
    }

    dropContent.style.display = "none";
    jobQueue.hidden = false;
    jobQueue.innerHTML = "";

    const heading = document.createElement("div");
    heading.className = "job-queue-heading";
    heading.textContent = "Jobs Queued";
    jobQueue.appendChild(heading);

    const header = document.createElement("div");
    header.className = "job-queue-header";
    header.innerHTML = `
      <span class="job-queue-count">${jobs.length} job${jobs.length > 1 ? "s" : ""} queued</span>
      <div class="frame-list-actions">
        <button type="button" class="icon-btn" id="addJobBtn" title="Add job" aria-label="Add job">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>
        </button>
        <button type="button" class="icon-btn" id="clearAllJobsBtn" title="Clear all jobs" aria-label="Clear all jobs">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"/></svg>
        </button>
      </div>
    `;
    jobQueue.appendChild(header);
    header.querySelector("#addJobBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      fileInputTarget = "newJob";
      fileInput.click();
    });
    header.querySelector("#clearAllJobsBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      clearAllJobs();
    });

    const list = document.createElement("div");
    list.className = "queue-list";
    jobQueue.appendChild(list);

    for (const job of jobs) {
      const row = document.createElement("div");
      row.className = `queue-row status-${job.status}`;
      row.dataset.jobId = job.id;
      const firstSource = job.sources[0];
      const thumbSrc = firstSource && firstSource.queueThumbUrl ? firstSource.queueThumbUrl : "";
      row.innerHTML = `
        <div class="queue-thumb">${thumbSrc ? `<img src="${thumbSrc}" alt="">` : ""}</div>
        <input type="text" class="queue-filename" value="${escapeHtml(job.settings.fileName)}">
        <span class="queue-status">${statusLabel(job)}</span>
        <button type="button" class="icon-btn queue-download" title="Download GIF" aria-label="Download GIF" ${job.status === "done" ? "" : "disabled"}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16"/></svg>
        </button>
        <button type="button" class="icon-btn queue-remove" title="Remove job" aria-label="Remove job">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>
        </button>
      `;
      const filenameInput = row.querySelector(".queue-filename");
      filenameInput.addEventListener("input", (e) => {
        job.settings.fileName = e.target.value;
        updateFileNameButton(job);
        updatePreviewTileName(job);
      });
      row.querySelector(".queue-download").addEventListener("click", (e) => {
        e.stopPropagation();
        downloadJob(job);
      });
      row.querySelector(".queue-remove").addEventListener("click", (e) => {
        e.stopPropagation();
        removeJob(job.id);
      });
      list.appendChild(row);
    }

    // lazily fetch queue-row thumbnails for jobs that don't have one yet
    jobs.forEach((job) => {
      const src = job.sources[0];
      if (src && !src.queueThumbUrl) {
        src.thumbnail(80).then((url) => {
          src.queueThumbUrl = url;
          const thumbEl = jobQueue.querySelector(`[data-job-id="${job.id}"] .queue-thumb`);
          if (thumbEl) thumbEl.innerHTML = `<img src="${url}" alt="">`;
        }).catch((err) => console.error(err));
      }
    });
  }

  function updateQueueRowStatus(job) {
    const row = jobQueue.querySelector(`[data-job-id="${job.id}"]`);
    if (!row) return;
    row.className = `queue-row status-${job.status}`;
    row.querySelector(".queue-status").textContent = statusLabel(job);
    const dl = row.querySelector(".queue-download");
    dl.disabled = job.status !== "done";
  }

  function updateFileNameButton(job) {
    const btn = filenameList.querySelector(`[data-job-id="${job.id}"]`);
    if (btn) btn.textContent = job.settings.fileName;
  }

  function clearAllJobs() {
    jobs.forEach((job) => { if (job.result && job.result.url) URL.revokeObjectURL(job.result.url); });
    jobs = [];
    activeJobId = null;
    renderJobQueue();
    renderFilenameList();
    renderPreviewGrid();
    renderJobBlocks().catch((err) => console.error(err));
    updateMakeGifState();
    updateMakeSelectedState();
    updateDownloadAllState();
    setStatus("Ready");
  }

  function removeJob(id) {
    const idx = jobs.findIndex((j) => j.id === id);
    if (idx === -1) return;
    const job = jobs[idx];
    if (job.result && job.result.url) URL.revokeObjectURL(job.result.url);
    jobs.splice(idx, 1);

    if (activeJobId === id) {
      const next = jobs[idx] || jobs[idx - 1] || null;
      activeJobId = next ? next.id : null;
    }

    renderJobQueue();
    renderFilenameList();
    renderPreviewGrid();
    if (activeJobId) populateSettingsPanel(getActiveJob());
    renderJobBlocks().catch((err) => console.error(err));
    updateMakeGifState();
    updateMakeSelectedState();
    updateDownloadAllState();
    setStatus(jobs.length ? `${jobs.length} job${jobs.length > 1 ? "s" : ""} queued` : "Ready");
  }

  // ---- settings-panel filename button list ----
  function renderFilenameList() {
    filenameList.innerHTML = "";
    for (const job of jobs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filename-btn";
      btn.dataset.jobId = job.id;
      btn.textContent = job.settings.fileName;
      btn.addEventListener("click", () => handleFilenameButtonClick(job));
      filenameList.appendChild(btn);
    }
  }

  // ---- stacked per-job frame grids with a selection swatch ----
  async function renderJobBlocks() {
    jobBlocks.innerHTML = "";

    if (jobs.length === 0) {
      jobBlocks.hidden = true;
      return;
    }
    jobBlocks.hidden = false;

    for (const job of jobs) {
      const block = document.createElement("div");
      block.className = "job-block" + (job.id === activeJobId ? " active" : "");
      block.dataset.jobId = job.id;

      const swatch = document.createElement("div");
      swatch.className = "job-swatch" + (job.id === activeJobId ? " active" : "");
      swatch.dataset.jobId = job.id;
      block.appendChild(swatch);

      const content = document.createElement("div");
      content.className = "job-block-content";

      const header = document.createElement("div");
      header.className = "frame-list-header";
      header.innerHTML = `
        <span class="frame-count">${job.sources.length} frame${job.sources.length > 1 ? "s" : ""}</span>
        <span class="job-block-status status-${job.status}">${statusLabel(job)}</span>
        <div class="frame-list-actions">
          <button type="button" class="icon-btn job-add-frames" title="Add frames to this job" aria-label="Add frames to this job">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>
          </button>
          <button type="button" class="icon-btn job-remove" title="Remove this job" aria-label="Remove this job">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>
          </button>
        </div>
      `;
      content.appendChild(header);

      header.querySelector(".job-add-frames").addEventListener("click", (e) => {
        e.stopPropagation();
        setActiveJob(job.id);
        fileInputTarget = "addFrames";
        fileInput.click();
      });
      header.querySelector(".job-remove").addEventListener("click", (e) => {
        e.stopPropagation();
        removeJob(job.id);
      });

      const grid = document.createElement("div");
      grid.className = "frame-grid";
      content.appendChild(grid);

      for (const src of job.sources) {
        if (!src.thumbUrl) src.thumbUrl = await src.thumbnail(160);

        const item = document.createElement("div");
        item.className = "frame-item" + (src.isSelected ? " selected" : "");
        item.draggable = true;
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
        item.addEventListener("dragstart", (e) => {
          e.stopPropagation();
          dragState = { type: "frame", jobId: job.id, fromIndex: job.sources.indexOf(src) };
          e.dataTransfer.effectAllowed = "move";
        });
        item.addEventListener("dragend", (e) => {
          e.stopPropagation();
          dragState = null;
          grid.querySelectorAll(".frame-item.drag-over").forEach((el) => el.classList.remove("drag-over"));
        });
        item.addEventListener("dragover", (e) => {
          if (!dragState || dragState.type !== "frame" || dragState.jobId !== job.id) return;
          e.preventDefault();
          e.stopPropagation();
          item.classList.add("drag-over");
        });
        item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
        item.addEventListener("drop", (e) => {
          if (!dragState || dragState.type !== "frame" || dragState.jobId !== job.id) return;
          e.preventDefault();
          e.stopPropagation();
          item.classList.remove("drag-over");
          const toIndex = job.sources.indexOf(src);
          const [moved] = job.sources.splice(dragState.fromIndex, 1);
          job.sources.splice(toIndex, 0, moved);
          dragState = null;
          renderJobBlocks().catch((err) => console.error(err));
        });
        grid.appendChild(item);
      }

      block.appendChild(content);
      block.draggable = true;
      block.addEventListener("click", (e) => {
        if (e.target.closest(".icon-btn") || e.target.closest(".frame-item")) return;
        setActiveJob(job.id);
      });
      block.addEventListener("dragstart", (e) => {
        dragState = { type: "job", jobId: job.id };
        e.dataTransfer.effectAllowed = "move";
      });
      block.addEventListener("dragend", () => {
        dragState = null;
        jobBlocks.querySelectorAll(".job-block.drag-over").forEach((el) => el.classList.remove("drag-over"));
      });
      block.addEventListener("dragover", (e) => {
        if (!dragState || dragState.type !== "job" || dragState.jobId === job.id) return;
        e.preventDefault();
        block.classList.add("drag-over");
      });
      block.addEventListener("dragleave", () => block.classList.remove("drag-over"));
      block.addEventListener("drop", (e) => {
        e.preventDefault();
        block.classList.remove("drag-over");
        if (!dragState || dragState.type !== "job" || dragState.jobId === job.id) return;
        const fromIdx = jobs.findIndex((j) => j.id === dragState.jobId);
        const toIdx = jobs.findIndex((j) => j.id === job.id);
        dragState = null;
        if (fromIdx === -1 || toIdx === -1) return;
        const [moved] = jobs.splice(fromIdx, 1);
        jobs.splice(toIdx, 0, moved);
        renderJobQueue();
        renderFilenameList();
        renderPreviewGrid();
        renderJobBlocks().catch((err) => console.error(err));
      });
      jobBlocks.appendChild(block);
    }
  }

  function updateJobBlockStatus(job) {
    const block = jobBlocks.querySelector(`[data-job-id="${job.id}"]`);
    if (!block) return;
    block.className = "job-block" + (job.id === activeJobId ? " active" : "");
    const statusEl = block.querySelector(".job-block-status");
    if (statusEl) {
      statusEl.className = `job-block-status status-${job.status}`;
      statusEl.textContent = statusLabel(job);
    }
  }

  // ---- preview grid ----
  function renderPreviewGrid() {
    if (jobs.length === 0) {
      previewEmpty.style.display = "";
      previewGrid.hidden = true;
      previewGrid.innerHTML = "";
      return;
    }

    previewEmpty.style.display = "none";
    previewGrid.hidden = false;
    previewGrid.innerHTML = "";

    for (const job of jobs) {
      const tile = document.createElement("div");
      tile.className = `preview-tile status-${job.status}` + (job.id === activeJobId ? " active" : "");
      tile.dataset.jobId = job.id;
      tile.innerHTML = `
        <div class="preview-tile-thumb">${job.status === "done" && job.result ? `<img src="${job.result.url}" alt="">` : ""}</div>
        <span class="preview-tile-name">${escapeHtml(job.settings.fileName)}</span>
        <span class="preview-tile-status">${previewTileInfo(job)}</span>
        <button type="button" class="preview-tile-download" ${job.status === "done" ? "" : "disabled"}>Download GIF</button>
      `;
      tile.querySelector(".preview-tile-download").addEventListener("click", (e) => {
        e.stopPropagation();
        downloadJob(job);
      });
      tile.addEventListener("click", (e) => {
        if (e.target.closest(".preview-tile-download")) return;
        setActiveJob(job.id);
      });
      previewGrid.appendChild(tile);
    }
  }

  function updatePreviewTile(job) {
    const tile = previewGrid.querySelector(`[data-job-id="${job.id}"]`);
    if (!tile) return;
    tile.className = `preview-tile status-${job.status}` + (job.id === activeJobId ? " active" : "");
    tile.querySelector(".preview-tile-status").textContent = previewTileInfo(job);
    const thumb = tile.querySelector(".preview-tile-thumb");
    const dl = tile.querySelector(".preview-tile-download");
    if (job.status === "done" && job.result) {
      thumb.innerHTML = `<img src="${job.result.url}" alt="">`;
      dl.disabled = false;
    } else {
      thumb.innerHTML = "";
      dl.disabled = true;
    }
  }

  function previewTileInfo(job) {
    return job.status === "done" && job.result ? formatFileSize(job.result.byteLength) : "";
  }

  function updatePreviewTileName(job) {
    const nameEl = previewGrid.querySelector(`[data-job-id="${job.id}"] .preview-tile-name`);
    if (nameEl) nameEl.textContent = job.settings.fileName;
  }

  downloadAllBtn.addEventListener("click", async () => {
    for (const job of jobs) {
      if (job.status === "done") await downloadJob(job);
    }
  });

  // ---- settings panel wiring (writes into the active job's settings) ----
  frameDelay.addEventListener("input", () => {
    frameDelayValue.textContent = `${parseFloat(frameDelay.value).toFixed(1)}s`;
    const job = getActiveJob();
    if (job) job.settings.frameDelay = parseFloat(frameDelay.value);
  });
  colourReduction.addEventListener("change", () => {
    const job = getActiveJob();
    if (job) job.settings.colourReduction = colourReduction.value;
  });
  ditherMode.addEventListener("change", () => {
    const job = getActiveJob();
    if (job) job.settings.ditherMode = ditherMode.value;
  });
  ditherStrength.addEventListener("change", () => {
    const v = Math.max(0, Math.min(100, Number(ditherStrength.value) || 0));
    ditherStrength.value = v;
    const job = getActiveJob();
    if (job) job.settings.ditherStrength = v;
  });
  loopCount.addEventListener("change", () => {
    const job = getActiveJob();
    if (job) job.settings.loopCount = Number(loopCount.value);
  });
  outWidth.addEventListener("change", () => {
    const job = getActiveJob();
    if (job) job.settings.outWidth = Number(outWidth.value);
  });
  outHeight.addEventListener("change", () => {
    const job = getActiveJob();
    if (job) job.settings.outHeight = Number(outHeight.value);
  });

  // ---- worker pool: parallel, batched frame dithering (per job) ----
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

  function refreshJobUI(job) {
    updateQueueRowStatus(job);
    updateJobBlockStatus(job);
    updatePreviewTile(job);
    updateDownloadAllState();
  }

  // ---- process a single queued job into a GIF ----
  async function processJob(job, jobIndex, totalJobs) {
    const selected = job.sources.filter((s) => s.isSelected);
    job.status = "processing";
    job.error = null;
    refreshJobUI(job);

    if (selected.length === 0) {
      job.status = "error";
      job.error = "No frames selected";
      refreshJobUI(job);
      setStatus(`Job ${jobIndex + 1} of ${totalJobs} — skipped, no frames selected`);
      return;
    }

    try {
      const width = Math.max(1, Math.round(Number(job.settings.outWidth)) || selected[0].nativeWidth);
      const height = Math.max(1, Math.round(Number(job.settings.outHeight)) || selected[0].nativeHeight);
      const delayCentiseconds = Math.round(parseFloat(job.settings.frameDelay) * 100);
      const loop = Number(job.settings.loopCount);
      const mode = job.settings.ditherMode;
      const strength = Number(job.settings.ditherStrength);

      // 1. Rasterise every selected source at the target size.
      setStatus(`Job ${jobIndex + 1} of ${totalJobs} — rendering frames…`);
      setProgress(0);
      const frames = [];
      for (let i = 0; i < selected.length; i++) {
        frames.push(await selected[i].render(width, height));
        setProgress(((i + 1) / selected.length) * 25);
      }

      // 2. Build one shared palette.
      setStatus(`Job ${jobIndex + 1} of ${totalJobs} — building colour palette…`);
      setProgress(30);
      const palette = Quantize.buildPalette(frames, 256);

      // 3. Dither + index each frame in parallel across a worker pool.
      setStatus(`Job ${jobIndex + 1} of ${totalJobs} — dithering frames (0/${frames.length})…`);
      const indexedFrames = await ditherFramesInPool(frames, palette, mode, strength, (done, total) => {
        setStatus(`Job ${jobIndex + 1} of ${totalJobs} — dithering frames (${done}/${total})…`);
        setProgress(35 + (done / total) * 55);
      });

      // 4. Encode the GIF.
      setStatus(`Job ${jobIndex + 1} of ${totalJobs} — encoding GIF…`);
      setProgress(95);
      const bytes = GifWriter.encode({
        width, height, palette, frames: indexedFrames, delayCentiseconds, loopCount: loop,
      });

      if (job.result && job.result.url) URL.revokeObjectURL(job.result.url);
      const blob = new Blob([bytes], { type: "image/gif" });
      const url = URL.createObjectURL(blob);
      job.result = { url, blob, byteLength: bytes.length, frameCount: frames.length };
      job.status = "done";
      setProgress(100);
    } catch (err) {
      console.error(err);
      job.status = "error";
      job.error = err.message || String(err);
    } finally {
      refreshJobUI(job);
    }
  }

  // ---- process the whole queue, one job at a time ----
  makeGifBtn.addEventListener("click", async () => {
    if (jobs.length === 0 || isProcessing) return;
    isProcessing = true;
    makeGifBtn.disabled = true;
    makeSelectedBtn.disabled = true;
    makeGifBtn.textContent = "Processing…";
    const startTime = performance.now();

    for (let i = 0; i < jobs.length; i++) {
      await processJob(jobs[i], i, jobs.length);
    }

    setProgress(null);
    setStatus(`Queue complete — ${formatDuration(performance.now() - startTime)}`);
    isProcessing = false;
    updateMakeGifState();
    updateMakeSelectedState();
  });

  // ---- process only the currently selected (active) job ----
  makeSelectedBtn.addEventListener("click", async () => {
    const job = getActiveJob();
    if (!job || isProcessing) return;
    isProcessing = true;
    makeGifBtn.disabled = true;
    makeSelectedBtn.disabled = true;
    makeSelectedBtn.textContent = "Processing…";
    const startTime = performance.now();

    await processJob(job, 0, 1);

    setProgress(null);
    setStatus(`Done — ${formatDuration(performance.now() - startTime)}`);
    makeSelectedBtn.textContent = "Make Selected GIF";
    isProcessing = false;
    updateMakeGifState();
    updateMakeSelectedState();
  });
})();
