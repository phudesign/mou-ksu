const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const config = require('../src/config/env');

// Matches the boxes in database/seed.sql (percent of page, origin top-left).
const BOXES = [
  { label: 'Rector', posX: 10, posY: 70, width: 25, height: 10 },
  { label: 'Vice Rector', posX: 40, posY: 70, width: 25, height: 10 },
  { label: 'Witness', posX: 70, posY: 70, width: 25, height: 10 },
];

async function main() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width: pw, height: ph } = page.getSize();

  page.drawText('Memorandum of Understanding (Sample)', { x: 60, y: ph - 90, size: 18, font: bold });
  page.drawText('Kalasin University — Academic Cooperation', { x: 60, y: ph - 120, size: 12, font });
  page.drawText('This is a sample document for development and testing.', {
    x: 60, y: ph - 160, size: 11, font, color: rgb(0.3, 0.3, 0.3),
  });

  for (const b of BOXES) {
    const x = (b.posX / 100) * pw;
    const w = (b.width / 100) * pw;
    const h = (b.height / 100) * ph;
    const y = ph - (b.posY / 100) * ph - h;
    page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 1 });
    page.drawText(b.label, { x: x + 4, y: y - 14, size: 10, font });
  }

  const outDir = path.join(config.upload.dir, 'pdfs');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'sample-mou.pdf');
  fs.writeFileSync(outPath, await pdf.save());
  console.log(`Created ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
