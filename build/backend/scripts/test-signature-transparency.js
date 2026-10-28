'use strict';

const assert = require('assert');
const { PNG } = require('pngjs');
const { assertTransparentSignature } = require('../src/utils/signaturePng');
const { HttpError } = require('../src/utils/http');

function encodePng({ width, height, paint }) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (width * y + x) << 2;
      const [r, g, b, a] = paint(x, y);
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = a;
    }
  }
  return PNG.sync.write(png);
}

const opaqueWhite = encodePng({
  width: 40,
  height: 40,
  paint: () => [255, 255, 255, 255],
});

const transparentInk = encodePng({
  width: 80,
  height: 40,
  paint: (x, y) => {
    if (x >= 10 && x < 70 && y >= 18 && y < 22) return [10, 10, 10, 255];
    return [0, 0, 0, 0];
  },
});

assert.throws(
  () => assertTransparentSignature(opaqueWhite),
  (err) => err instanceof HttpError && err.status === 400 && /transparent background/.test(err.message)
);
assert.doesNotThrow(() => assertTransparentSignature(transparentInk));

console.log('test-signature-transparency: ok');
