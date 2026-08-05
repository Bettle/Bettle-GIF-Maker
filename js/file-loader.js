// Loads dropped/browsed files into an ordered list of "sources" that can be
// rasterised on demand at whatever output size the user picks. A multipage
// PDF becomes one source per page; PNG/JPG files become one source each,
// ordered by filename (a "frame sequence").
(function (global) {

  function flattenOntoCanvas(drawFn, srcW, srcH, outW, outH) {
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outW, outH);
    drawFn(ctx, outW, outH);
    return ctx.getImageData(0, 0, outW, outH);
  }

  async function pdfPageSource(page, name) {
    const nativeViewport = page.getViewport({ scale: 1 });
    return {
      name,
      nativeWidth: Math.round(nativeViewport.width),
      nativeHeight: Math.round(nativeViewport.height),
      async render(outW, outH) {
        const scale = Math.max(outW / nativeViewport.width, outH / nativeViewport.height, 1);
        const viewport = page.getViewport({ scale });
        const renderCanvas = document.createElement("canvas");
        renderCanvas.width = Math.ceil(viewport.width);
        renderCanvas.height = Math.ceil(viewport.height);
        const renderCtx = renderCanvas.getContext("2d");
        renderCtx.fillStyle = "#ffffff";
        renderCtx.fillRect(0, 0, renderCanvas.width, renderCanvas.height);
        await page.render({ canvasContext: renderCtx, viewport }).promise;

        return flattenOntoCanvas((ctx, w, h) => {
          ctx.drawImage(renderCanvas, 0, 0, renderCanvas.width, renderCanvas.height, 0, 0, w, h);
        }, renderCanvas.width, renderCanvas.height, outW, outH);
      },
      async thumbnail(maxSize) {
        const { w, h } = thumbDimensions(this.nativeWidth, this.nativeHeight, maxSize);
        const data = await this.render(w, h);
        return imageDataToDataUrl(data);
      },
    };
  }

  function imageSource(img, name) {
    return {
      name,
      nativeWidth: img.naturalWidth || img.width,
      nativeHeight: img.naturalHeight || img.height,
      async render(outW, outH) {
        return flattenOntoCanvas((ctx, w, h) => {
          ctx.drawImage(img, 0, 0, w, h);
        }, img.naturalWidth || img.width, img.naturalHeight || img.height, outW, outH);
      },
      async thumbnail(maxSize) {
        const { w, h } = thumbDimensions(this.nativeWidth, this.nativeHeight, maxSize);
        const data = await this.render(w, h);
        return imageDataToDataUrl(data);
      },
    };
  }

  function thumbDimensions(nativeW, nativeH, maxSize) {
    const scale = Math.min(maxSize / nativeW, maxSize / nativeH);
    return {
      w: Math.max(1, Math.round(nativeW * scale)),
      h: Math.max(1, Math.round(nativeH * scale)),
    };
  }

  function imageDataToDataUrl(imageData) {
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext("2d").putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  }

  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = reject;
      img.src = url;
    });
  }

  async function loadPdfFile(file) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const sources = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      sources.push(await pdfPageSource(page, `${file.name} — page ${n}`));
    }
    return sources;
  }

  async function loadFiles(fileList) {
    const files = Array.from(fileList);
    const pdfFile = files.find((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));

    if (pdfFile) {
      return loadPdfFile(pdfFile);
    }

    const imageFiles = files
      .filter((f) => /\.(png|jpe?g)$/i.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    const sources = [];
    for (const f of imageFiles) {
      const img = await loadImageFile(f);
      sources.push(imageSource(img, f.name));
    }
    return sources;
  }

  global.FileLoader = { loadFiles };
})(window);
