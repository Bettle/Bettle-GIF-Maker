// Minimal GIF89a encoder: writes the header, a single global colour table,
// a NETSCAPE2.0 loop extension, and one image block per frame using
// standard variable-width LZW compression. No external dependencies.
(function (global) {

  class ByteWriter {
    constructor() { this.chunks = []; this.length = 0; }
    push(...bytes) { this.chunks.push(bytes); this.length += bytes.length; }
    pushArray(arr) { this.chunks.push(arr); this.length += arr.length; }
    pushString(str) { this.push(...Array.from(str, (c) => c.charCodeAt(0))); }
    toUint8Array() {
      const out = new Uint8Array(this.length);
      let offset = 0;
      for (const chunk of this.chunks) { out.set(chunk, offset); offset += chunk.length; }
      return out;
    }
  }

  function le16(n) { return [n & 0xff, (n >> 8) & 0xff]; }

  function bitsForColors(n) {
    let bits = 1;
    while ((1 << bits) < n) bits++;
    return bits;
  }

  // Standard LZW encoding for GIF image data (dictionary resets per frame).
  function lzwEncode(indices, minCodeSize) {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    const maxDictSize = 4096;

    let codeSize, nextCode, dict;
    const reset = () => {
      codeSize = minCodeSize + 1;
      nextCode = eoiCode + 1;
      dict = new Map();
    };
    reset();

    const bytes = [];
    let bitBuffer = 0, bitCount = 0;
    const emit = (code) => {
      bitBuffer |= code << bitCount;
      bitCount += codeSize;
      while (bitCount >= 8) {
        bytes.push(bitBuffer & 0xff);
        bitBuffer >>= 8;
        bitCount -= 8;
      }
    };

    emit(clearCode);

    if (indices.length === 0) {
      emit(eoiCode);
    } else {
      let w = String(indices[0]);
      for (let i = 1; i < indices.length; i++) {
        const k = indices[i];
        const wk = w + "," + k;
        if (dict.has(wk)) {
          w = wk;
          continue;
        }
        emit(w.indexOf(",") === -1 ? Number(w) : dict.get(w));
        // Code-size bump (and dictionary reset) must be checked against the
        // code about to be assigned, *before* it's handed out — bumping
        // after incrementing fires one emission too early and desyncs every
        // GIF-spec-compliant decoder (checked against Pillow + Chromium).
        if (nextCode === maxDictSize) {
          emit(clearCode);
          reset();
        } else {
          if (nextCode >= (1 << codeSize) && codeSize < 12) codeSize++;
          dict.set(wk, nextCode);
          nextCode++;
        }
        w = String(k);
      }
      emit(w.indexOf(",") === -1 ? Number(w) : dict.get(w));
      emit(eoiCode);
    }

    if (bitCount > 0) bytes.push(bitBuffer & 0xff);
    return bytes;
  }

  function writeSubBlocks(writer, bytes) {
    let offset = 0;
    while (offset < bytes.length) {
      const len = Math.min(255, bytes.length - offset);
      writer.push(len);
      writer.pushArray(bytes.slice(offset, offset + len));
      offset += len;
    }
    writer.push(0x00);
  }

  // opts: { width, height, palette: Uint8Array(n*3), frames: [Uint8Array indices],
  //         delayCentiseconds (number, or one per frame), loopCount (0 = infinite) }
  function encode(opts) {
    const { width, height, palette, frames, delayCentiseconds, loopCount } = opts;
    const delays = Array.isArray(delayCentiseconds) ? delayCentiseconds : frames.map(() => delayCentiseconds);
    const w = new ByteWriter();

    const numColors = Math.max(2, palette.length / 3);
    const tableBits = bitsForColors(numColors);
    const tableSize = 1 << tableBits;

    w.pushString("GIF89a");
    w.pushArray(le16(width));
    w.pushArray(le16(height));
    w.push(0x80 | (0x70) | (tableBits - 1)); // global colour table, 8-bit colour res
    w.push(0x00); // background colour index
    w.push(0x00); // pixel aspect ratio

    const gct = new Uint8Array(tableSize * 3);
    gct.set(palette.subarray(0, numColors * 3));
    w.pushArray(gct);

    // NETSCAPE2.0 looping extension
    w.push(0x21, 0xff, 0x0b);
    w.pushString("NETSCAPE2.0");
    w.push(0x03, 0x01);
    w.pushArray(le16(loopCount || 0));
    w.push(0x00);

    const minCodeSize = Math.max(2, tableBits);

    for (let i = 0; i < frames.length; i++) {
      const indices = frames[i];
      // Graphic Control Extension
      w.push(0x21, 0xf9, 0x04);
      w.push(0x04); // disposal method 1 (do not dispose), no transparency
      w.pushArray(le16(delays[i]));
      w.push(0x00); // transparent colour index (unused)
      w.push(0x00);

      // Image Descriptor
      w.push(0x2c);
      w.pushArray(le16(0));
      w.pushArray(le16(0));
      w.pushArray(le16(width));
      w.pushArray(le16(height));
      w.push(0x00); // no local colour table, no interlace

      w.push(minCodeSize);
      const compressed = lzwEncode(indices, minCodeSize);
      writeSubBlocks(w, compressed);
    }

    w.push(0x3b); // trailer

    return w.toUint8Array();
  }

  const api = { encode };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.GifWriter = api;
})(typeof self !== "undefined" ? self : this);
