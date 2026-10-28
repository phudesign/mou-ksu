'use strict';

const { PNG } = require('pngjs');
const { HttpError } = require('./http');

/** At least this fraction of pixels must have alpha < 255. */
const MIN_TRANSPARENT_RATIO = 0.05;
/** At least this fraction must look like ink (visible, not near-white). */
const MIN_INK_RATIO = 0.002;

/**
 * Ensures a signature PNG has a transparent background and visible ink.
 * @param {Buffer} bytes
 */
function assertTransparentSignature(bytes) {
  let png;
  try {
    png = PNG.sync.read(bytes);
  } catch {
    throw new HttpError(400, 'Signature must be a valid PNG image');
  }
  const { width, height, data } = png;
  const total = width * height;
  if (!total) throw new HttpError(400, 'Signature image is empty');

  let transparent = 0;
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 255) transparent += 1;
    if (a >= 128) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < 200) ink += 1;
    }
  }

  if (transparent / total < MIN_TRANSPARENT_RATIO) {
    throw new HttpError(400, 'Signature must have a transparent background');
  }
  if (ink / total < MIN_INK_RATIO) {
    throw new HttpError(400, 'Signature image has no visible ink');
  }
}

module.exports = {
  assertTransparentSignature,
  MIN_TRANSPARENT_RATIO,
  MIN_INK_RATIO,
};
