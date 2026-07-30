// Median-cut colour quantiser (RGB space only). Builds one palette from
// sampled pixels across every frame, reused for the whole export.
(function (global) {
  const MAX_SAMPLE_POINTS = 30000;

  function collectSamples(frames) {
    // frames: [{ data: Uint8ClampedArray (RGBA) }]
    let totalPixels = 0;
    for (const f of frames) totalPixels += f.data.length / 4;

    const stride = Math.max(1, Math.floor(totalPixels / MAX_SAMPLE_POINTS));
    const samples = [];
    let seen = 0;

    for (const f of frames) {
      const d = f.data;
      for (let p = 0; p < d.length / 4; p++) {
        if (seen % stride === 0) {
          const i = p * 4;
          samples.push([d[i], d[i + 1], d[i + 2]]);
        }
        seen++;
      }
    }
    return samples;
  }

  function boxRange(points) {
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (const [r, g, b] of points) {
      if (r < rMin) rMin = r; if (r > rMax) rMax = r;
      if (g < gMin) gMin = g; if (g > gMax) gMax = g;
      if (b < bMin) bMin = b; if (b > bMax) bMax = b;
    }
    const rRange = rMax - rMin, gRange = gMax - gMin, bRange = bMax - bMin;
    let channel = 0, range = rRange;
    if (gRange > range) { channel = 1; range = gRange; }
    if (bRange > range) { channel = 2; range = bRange; }
    return { channel, range };
  }

  function splitBox(points) {
    const { channel } = boxRange(points);
    points.sort((a, b) => a[channel] - b[channel]);
    const mid = Math.floor(points.length / 2);
    return [points.slice(0, mid), points.slice(mid)];
  }

  function averageColor(points) {
    let r = 0, g = 0, b = 0;
    for (const p of points) { r += p[0]; g += p[1]; b += p[2]; }
    const n = points.length || 1;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }

  // Returns a Uint8Array of length paletteSize*3 (RGB triples).
  function buildPalette(frames, maxColors) {
    maxColors = Math.max(2, Math.min(256, maxColors || 256));

    const samples = collectSamples(frames);
    if (samples.length === 0) {
      return new Uint8Array(0);
    }

    // If the image already has few unique colours, use them directly.
    const uniqueKey = new Set();
    for (const p of samples) uniqueKey.add((p[0] << 16) | (p[1] << 8) | p[2]);
    if (uniqueKey.size <= maxColors) {
      const out = new Uint8Array(uniqueKey.size * 3);
      let i = 0;
      for (const key of uniqueKey) {
        out[i++] = (key >> 16) & 0xff;
        out[i++] = (key >> 8) & 0xff;
        out[i++] = key & 0xff;
      }
      return out;
    }

    let boxes = [samples];
    while (boxes.length < maxColors) {
      // Split the box with the largest colour range (most visually significant).
      let splitIndex = -1, bestRange = -1;
      for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].length < 2) continue;
        const { range } = boxRange(boxes[i]);
        if (range > bestRange) { bestRange = range; splitIndex = i; }
      }
      if (splitIndex === -1) break; // nothing left worth splitting

      const [a, b] = splitBox(boxes[splitIndex]);
      boxes.splice(splitIndex, 1, a, b);
    }

    const palette = new Uint8Array(boxes.length * 3);
    for (let i = 0; i < boxes.length; i++) {
      const [r, g, b] = averageColor(boxes[i]);
      palette[i * 3] = r;
      palette[i * 3 + 1] = g;
      palette[i * 3 + 2] = b;
    }
    return palette;
  }

  function nearestColorIndex(palette, r, g, b) {
    let best = 0, bestDist = Infinity;
    const n = palette.length / 3;
    for (let i = 0; i < n; i++) {
      const dr = palette[i * 3] - r;
      const dg = palette[i * 3 + 1] - g;
      const db = palette[i * 3 + 2] - b;
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    return best;
  }

  const api = { buildPalette, nearestColorIndex };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.Quantize = api;
})(typeof self !== "undefined" ? self : this);
