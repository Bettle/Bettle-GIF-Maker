// Runs off the main thread: dithers one frame against the shared palette
// and returns indexed pixel data. Palette is computed once on the main
// thread and reused for every frame (never recalculated per frame).
importScripts("quantize.js");

function ditherFrame(rgba, width, height, palette, mode, strengthPct) {
  const n = width * height;
  const indices = new Uint8Array(n);
  const strength = Math.max(0, Math.min(100, strengthPct)) / 100;

  if (mode === "none" || palette.length === 3) {
    for (let p = 0; p < n; p++) {
      const i = p * 4;
      indices[p] = Quantize.nearestColorIndex(palette, rgba[i], rgba[i + 1], rgba[i + 2]);
    }
    return indices;
  }

  // Working buffer holds the running (error-diffused) colour per pixel.
  const work = new Float32Array(n * 3);
  for (let p = 0; p < n; p++) {
    const i = p * 4, j = p * 3;
    work[j] = rgba[i];
    work[j + 1] = rgba[i + 1];
    work[j + 2] = rgba[i + 2];
  }

  const addError = (x, y, er, eg, eb, w) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const j = (y * width + x) * 3;
    work[j] += er * w;
    work[j + 1] += eg * w;
    work[j + 2] += eb * w;
  };

  const diffusionWeights = [
    [1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16],
  ];
  const atkinsonWeights = [
    [1, 0, 1 / 8], [2, 0, 1 / 8],
    [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8],
    [0, 2, 1 / 8],
  ];
  const weights = mode === "atkinson" ? atkinsonWeights : diffusionWeights;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x, j = p * 3;
      const r = Math.max(0, Math.min(255, work[j]));
      const g = Math.max(0, Math.min(255, work[j + 1]));
      const b = Math.max(0, Math.min(255, work[j + 2]));

      const idx = Quantize.nearestColorIndex(palette, r, g, b);
      indices[p] = idx;

      const er = (r - palette[idx * 3]) * strength;
      const eg = (g - palette[idx * 3 + 1]) * strength;
      const eb = (b - palette[idx * 3 + 2]) * strength;

      for (const [dx, dy, w] of weights) addError(x + dx, y + dy, er, eg, eb, w);
    }
  }

  return indices;
}

self.onmessage = (e) => {
  const { frameId, width, height, rgba, palette, ditherMode, ditherStrength } = e.data;
  const indices = ditherFrame(rgba, width, height, palette, ditherMode, ditherStrength);
  self.postMessage({ frameId, indices }, [indices.buffer]);
};
