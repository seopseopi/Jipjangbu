import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import test from "node:test";

const read = (path, encoding) => readFileSync(new URL(`../${path}`, import.meta.url), encoding);

// The existing logo generator emits non-interlaced, 8-bit RGBA PNGs. Decode
// their scanline filters so CI checks the shipped pixels without Pillow or a browser.
function rgbaPng(path, expectedSize) {
  const png = read(path);
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(png.readUInt32BE(16), expectedSize);
  assert.equal(png.readUInt32BE(20), expectedSize);
  assert.deepEqual([...png.subarray(24, 29)], [8, 6, 0, 0, 0]);
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = expectedSize * 4;
  assert.equal(raw.length, expectedSize * (stride + 1));
  const pixels = Buffer.alloc(expectedSize * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < expectedSize; y++) {
    const filter = raw[y * (stride + 1)];
    assert(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= 4 ? pixels[i - 4] : 0, b = y ? pixels[i - stride] : 0, c = y && x >= 4 ? pixels[i - stride - 4] : 0;
      const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      pixels[i] = (raw[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  return (x, y) => [...pixels.subarray((y * expectedSize + x) * 4, (y * expectedSize + x) * 4 + 4)];
}

test("README·SVG 파비콘은 흰색 배경에 네이비 원본 기호를 표시한다", () => {
  const tile = read("docs/assets/jipjangbu-mark-tile.svg", "utf8");
  assert.match(tile, /<rect[^>]*fill="#ffffff"[^>]*stroke="#d8dde6"/);
  assert.match(tile, /<path fill="#13254a"/);
  assert(tile.indexOf("<rect") < tile.indexOf("<path"));
  assert.equal(read("public/favicon.svg", "utf8"), tile);
  assert.match(read("README.md", "utf8"), /<img src="docs\/assets\/jipjangbu-mark-tile\.svg"/);
});

test("실제 PNG 아이콘은 밝은 불투명 바탕·네이비 기호를 유지하며 변경된 주소로 제공한다", () => {
  for (const [name, size] of [["jipjangbu-icon-bright.png", 192], ["jipjangbu-icon.png", 96]]) {
    const pixel = rgbaPng(`public/${name}`, size);
    assert.deepEqual(pixel(size / 2, Math.round(size * 0.16)), [255, 255, 255, 255], "light background behind the symbol");
    assert.deepEqual(pixel(size / 2, Math.round(size * 0.31)), [19, 37, 74, 255], "original navy ridge");
    assert.deepEqual(pixel(size / 2, Math.round(size * 0.85)), [255, 255, 255, 255]);
  }
  const layout = read("app/layout.tsx", "utf8");
  assert.equal((layout.match(/\/jipjangbu-icon-bright\.png\?v=20260916-light/g) ?? []).length, 3);
  const css = read("app/globals.css", "utf8");
  assert.match(css, /\.brand-mark, \.login-logo\s*\{[^}]*background: #fff url\("\/jipjangbu-logo\.png\?v=20260916-light"\)/);
});
