// Runs off the main thread: dithers one frame against the shared palette
// and returns indexed pixel data. Palette is computed once on the main
// thread and reused for every frame (never recalculated per frame).
importScripts("quantize.js");

// 4x4 Bayer ordered-dither matrix, used by "pattern" mode.
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function ditherFrame(rgba, width, height, palette, mode, strengthPct, colourReduction) {
  const n = width * height;
  const indices = new Uint8Array(n);
  const strength = Math.max(0, Math.min(100, strengthPct)) / 100;

  // A perceptually-built palette should be perceptually matched too, not
  // just perceptually built — bias the nearest-colour distance the same way.
  const perceptual = colourReduction === "perceptual";
  const wr = perceptual ? 0.299 : 1, wg = perceptual ? 0.587 : 1, wb = perceptual ? 0.114 : 1;

  if (mode === "none" || palette.length === 3) {
    for (let p = 0; p < n; p++) {
      const i = p * 4;
      indices[p] = Quantize.nearestColorIndex(palette, rgba[i], rgba[i + 1], rgba[i + 2], wr, wg, wb);
    }
    return indices;
  }

  if (mode === "pattern" || mode === "noise") {
    // No error propagation — each pixel gets an independent offset before
    // quantizing: a fixed ordered pattern, or fresh random jitter.
    const amount = 255 * strength;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x, i = p * 4;
        let tr, tg, tb;
        if (mode === "pattern") {
          const t = (BAYER_4X4[y % 4][x % 4] / 16 - 0.5) * amount;
          tr = tg = tb = t;
        } else {
          tr = (Math.random() - 0.5) * amount;
          tg = (Math.random() - 0.5) * amount;
          tb = (Math.random() - 0.5) * amount;
        }
        const r = Math.max(0, Math.min(255, rgba[i] + tr));
        const g = Math.max(0, Math.min(255, rgba[i + 1] + tg));
        const b = Math.max(0, Math.min(255, rgba[i + 2] + tb));
        indices[p] = Quantize.nearestColorIndex(palette, r, g, b, wr, wg, wb);
      }
    }
    return indices;
  }

  // "diffusion" (Floyd–Steinberg): working buffer holds the running
  // (error-diffused) colour per pixel.
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

  const weights = [
    [1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16],
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x, j = p * 3;
      const r = Math.max(0, Math.min(255, work[j]));
      const g = Math.max(0, Math.min(255, work[j + 1]));
      const b = Math.max(0, Math.min(255, work[j + 2]));

      const idx = Quantize.nearestColorIndex(palette, r, g, b, wr, wg, wb);
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
  const { frameId, width, height, rgba, palette, ditherMode, ditherStrength, colourReduction } = e.data;
  const indices = ditherFrame(rgba, width, height, palette, ditherMode, ditherStrength, colourReduction);
  self.postMessage({ frameId, indices }, [indices.buffer]);
};
