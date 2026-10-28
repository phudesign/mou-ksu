const fs = require('fs/promises');
const { PDFDocument, degrees } = require('pdf-lib');

// Maps a point in the displayed page (origin top-left, page rotation applied, as viewers render it)
// to PDF user space (origin bottom-left of the unrotated crop box).
function displayToPdf(u, v, rotation, crop) {
  const { x: cx, y: cy, width: cw, height: ch } = crop;
  switch (rotation) {
    case 90:
      return { x: cx + v, y: cy + u };
    case 180:
      return { x: cx + cw - u, y: cy + v };
    case 270:
      return { x: cx + cw - v, y: cy + ch - u };
    default:
      return { x: cx + u, y: cy + ch - v };
  }
}

function normalizeRotation(angle) {
  return (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
}

/**
 * Stamps PNG signatures onto a PDF.
 * Each stamp: { pageNumber (1-based), posX, posY, width, height (percent of displayed page), pngBytes }
 * The image is scaled to fit inside the box (aspect ratio preserved) and centered.
 */
async function stampSignatures({ sourcePath, outputPath, stamps }) {
  const pdf = await PDFDocument.load(await fs.readFile(sourcePath));
  const pages = pdf.getPages();

  for (const stamp of stamps) {
    const page = pages[stamp.pageNumber - 1];
    if (!page) throw new Error(`Page ${stamp.pageNumber} does not exist`);

    const rotation = normalizeRotation(page.getRotation().angle);
    const crop = page.getCropBox();
    const quarterTurn = rotation === 90 || rotation === 270;
    const pageW = quarterTurn ? crop.height : crop.width;
    const pageH = quarterTurn ? crop.width : crop.height;

    const boxL = (stamp.posX / 100) * pageW;
    const boxT = (stamp.posY / 100) * pageH;
    const boxW = (stamp.width / 100) * pageW;
    const boxH = (stamp.height / 100) * pageH;

    const image = await pdf.embedPng(stamp.pngBytes);
    const scale = Math.min(boxW / image.width, boxH / image.height);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    const left = boxL + (boxW - drawW) / 2;
    const top = boxT + (boxH - drawH) / 2;

    const origin = displayToPdf(left, top + drawH, rotation, crop);
    page.drawImage(image, {
      x: origin.x,
      y: origin.y,
      width: drawW,
      height: drawH,
      rotate: degrees(rotation),
    });
  }

  await fs.writeFile(outputPath, await pdf.save());
  return outputPath;
}

module.exports = { stampSignatures };
