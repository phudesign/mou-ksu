// Fills the database with demo MOUs and signatures for trying out lists and pagination.
// Re-running replaces the previous demo data (MOUs whose PDF is pdfs/demo-*.pdf); other data is untouched.
// Usage: npm run seed-demo            → 100 MOUs, 100 signatures
//        npm run seed-demo -- --clean → only remove the demo data
const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { pool } = require('../src/config/db');
const { DIRS, absUploadPath, writeUpload, removeFileQuietly } = require('../src/utils/files');
const { stampSignatures } = require('../src/services/pdfService');

const MOU_COUNT = 100;
// Signed boxes per MOU, oldest MOU first: 20 completed (60) + 10 with two (20) + 20 with one (20) = 100 signatures.
const SIGNED_BOXES = [...Array(20).fill(3), ...Array(10).fill(2), ...Array(20).fill(1)];
const DEMO_PDF_PREFIX = `${DIRS.pdfs}/demo-`;
const DEMO_IP = '127.0.0.1';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Same layout as database/seed.sql and scripts/create-sample-pdf.js.
const BOXES = [
  { username: 'rector', roleName: 'อธิการบดี', label: 'Rector', posX: 10, posY: 70, width: 25, height: 10 },
  { username: 'vice_rector', roleName: 'รองอธิการบดี', label: 'Vice Rector', posX: 40, posY: 70, width: 25, height: 10 },
  { username: 'witness', roleName: 'พยาน', label: 'Witness', posX: 70, posY: 70, width: 25, height: 10 },
];

const TOPICS = [
  ['วิชาการและการวิจัย', 'Academic and Research Cooperation'],
  ['การแลกเปลี่ยนนักศึกษา', 'Student Exchange'],
  ['การพัฒนาบุคลากร', 'Staff Development'],
  ['การฝึกประสบการณ์วิชาชีพ', 'Professional Internship'],
  ['นวัตกรรมเกษตร', 'Agricultural Innovation'],
  ['การท่องเที่ยวเชิงวัฒนธรรม', 'Cultural Tourism'],
  ['เทคโนโลยีดิจิทัล', 'Digital Technology'],
  ['สาธารณสุขชุมชน', 'Community Health'],
  ['พลังงานทดแทน', 'Renewable Energy'],
  ['ผ้าไหมแพรวาและหัตถกรรม', 'Praewa Silk and Handicrafts'],
];

const PARTNERS = [
  'องค์การบริหารส่วนจังหวัดกาฬสินธุ์',
  'เทศบาลเมืองกาฬสินธุ์',
  'โรงพยาบาลกาฬสินธุ์',
  'สำนักงานเกษตรจังหวัดกาฬสินธุ์',
  'สำนักงานการท่องเที่ยวและกีฬาจังหวัดกาฬสินธุ์',
  'บริษัท ไทยดิจิทัลโซลูชัน จำกัด',
  'สหกรณ์การเกษตรกาฬสินธุ์ จำกัด',
  'วิทยาลัยเทคนิคกาฬสินธุ์',
  'สำนักงานเขตพื้นที่การศึกษาประถมศึกษากาฬสินธุ์',
  'หอการค้าจังหวัดกาฬสินธุ์',
  'Savannakhet University',
  'Hanoi University of Agriculture',
];

/** Deterministic PRNG so every run produces the same dataset. */
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

/** A transparent PNG with a pen-like scribble, different for every seed. */
function signaturePng(seed) {
  const random = mulberry32(seed);
  const w = 360;
  const h = 120;
  const pixels = Buffer.alloc(w * h * 4);
  const loops = 3 + Math.floor(random() * 3);
  const amp = 18 + random() * 14;
  const phase = random() * Math.PI * 2;
  const radius = 2.2;

  const dot = (cx, cy) => {
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        if (x < 0 || y < 0 || x >= w || y >= h || (x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) continue;
        const i = (y * w + x) * 4;
        pixels.set([13, 27, 94, 255], i);
      }
    }
  };

  for (let t = 0; t <= 1; t += 0.0005) {
    const x = 30 + t * 300 + Math.sin(t * Math.PI * 2 * loops + phase) * 22;
    const y = 60 + Math.cos(t * Math.PI * 2 * loops + phase) * amp * (1 - t * 0.5) + Math.sin(t * 9) * 6;
    dot(x, y);
  }
  for (let t = 0; t <= 1; t += 0.002) dot(40 + t * 280, 98 - t * 10);

  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) pixels.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function createPdf(no, topicEn) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width: pw, height: ph } = page.getSize();

  page.drawText('Memorandum of Understanding', { x: 60, y: ph - 90, size: 18, font: bold });
  page.drawText(`Demo document No. ${no}`, { x: 60, y: ph - 118, size: 12, font });
  page.drawText(`Kalasin University - ${topicEn}`, { x: 60, y: ph - 138, size: 12, font });
  page.drawText('Generated by scripts/seed-demo-data.js for development and testing.', {
    x: 60, y: ph - 175, size: 10, font, color: rgb(0.4, 0.4, 0.4),
  });

  for (const b of BOXES) {
    const x = (b.posX / 100) * pw;
    const w = (b.width / 100) * pw;
    const h = (b.height / 100) * ph;
    const y = ph - (b.posY / 100) * ph - h;
    page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 1 });
    page.drawText(b.label, { x: x + 4, y: y - 14, size: 10, font });
  }
  return pdf.save();
}

async function audit(conn, { userId, action, mouId, details, at }) {
  await conn.execute(
    `INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address, created_at)
     VALUES (?, ?, 'mou', ?, ?, ?, ?)`,
    [userId, action, mouId, JSON.stringify(details), DEMO_IP, at]
  );
}

async function removeDemoData() {
  const [mous] = await pool.execute(
    'SELECT id, pdf_path, signed_pdf_path FROM mou_documents WHERE pdf_path LIKE ?',
    [`${DEMO_PDF_PREFIX}%`]
  );
  if (!mous.length) return 0;
  const ids = mous.map((m) => m.id);
  const marks = ids.map(() => '?').join(',');
  await pool.query(`DELETE FROM audit_logs WHERE target_type = 'mou' AND target_id IN (${marks})`, ids);
  await pool.query(`DELETE FROM mou_documents WHERE id IN (${marks})`, ids);
  for (const m of mous) {
    await removeFileQuietly(m.pdf_path);
    await removeFileQuietly(m.signed_pdf_path);
    await fs.rm(absUploadPath(path.posix.join(DIRS.mouSignatures, String(m.id))), { recursive: true, force: true });
  }
  return mous.length;
}

async function main() {
  const removed = await removeDemoData();
  if (removed) console.log(`Removed ${removed} previous demo MOUs`);
  if (process.argv.includes('--clean')) return;

  const [users] = await pool.query("SELECT id, username FROM users WHERE username IN ('admin', 'rector', 'vice_rector', 'witness')");
  const idOf = Object.fromEntries(users.map((u) => [u.username, u.id]));
  const missing = ['admin', ...BOXES.map((b) => b.username)].filter((u) => !idOf[u]);
  if (missing.length) throw new Error(`Seed users not found: ${missing.join(', ')} (load database/seed.sql first)`);

  const random = mulberry32(2026);
  const signatureImages = BOXES.map((_, i) => signaturePng(i + 1));
  const now = Date.now();
  let signatureCount = 0;
  let completedCount = 0;

  for (let i = 0; i < MOU_COUNT; i++) {
    const no = String(i + 1).padStart(3, '0');
    const [topicTh, topicEn] = TOPICS[i % TOPICS.length];
    const partner = PARTNERS[Math.floor(random() * PARTNERS.length)];
    const title = `MOU ทดสอบ #${no} — ความร่วมมือด้าน${topicTh} กับ${partner}`;
    // Oldest first, roughly one MOU a day over the last ~100 days.
    const createdAt = new Date(now - (MOU_COUNT - i) * DAY + Math.floor(random() * 8) * HOUR);
    const signedBoxes = SIGNED_BOXES[i] ?? 0;

    const pdfPath = `${DEMO_PDF_PREFIX}${no}.pdf`;
    await writeUpload(pdfPath, await createPdf(no, topicEn));

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Alternate public/private so demo lists exercise visibility filtering.
      const visibility = i % 3 === 0 ? 'public' : 'private';
      const [mou] = await conn.execute(
        'INSERT INTO mou_documents (title, pdf_path, status, visibility, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [title, pdfPath, 'pending', visibility, idOf.admin, createdAt]
      );
      const mouId = mou.insertId;
      await audit(conn, { userId: idOf.admin, action: 'mou_upload', mouId, details: { title, boxes: BOXES.length }, at: createdAt });

      let signedAt = createdAt.getTime();
      for (const [b, box] of BOXES.entries()) {
        const isSigned = b < signedBoxes;
        const [boxRow] = await conn.execute(
          `INSERT INTO mou_signature_boxes (mou_id, user_id, role_name, page_number, pos_x, pos_y, width, height, is_signed)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
          [mouId, idOf[box.username], box.roleName, box.posX, box.posY, box.width, box.height, isSigned]
        );
        if (!isSigned) continue;

        signedAt += (2 + Math.floor(random() * 30)) * HOUR;
        const imagePath = path.posix.join(DIRS.mouSignatures, String(mouId), `demo-${b + 1}.png`);
        await writeUpload(imagePath, signatureImages[b]);
        await conn.execute(
          `INSERT INTO mou_signatures (mou_id, box_id, user_id, signature_image_path, ip_address, signed_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [mouId, boxRow.insertId, idOf[box.username], imagePath, DEMO_IP, new Date(signedAt)]
        );
        await audit(conn, {
          userId: idOf[box.username],
          action: 'signature_submit',
          mouId,
          details: { boxId: boxRow.insertId, completed: b === BOXES.length - 1 },
          at: new Date(signedAt),
        });
        signatureCount++;
      }

      if (signedBoxes === BOXES.length) {
        const signedPdfPath = path.posix.join(DIRS.signed, `mou_${mouId}_demo.pdf`);
        await stampSignatures({
          sourcePath: absUploadPath(pdfPath),
          outputPath: absUploadPath(signedPdfPath),
          stamps: BOXES.map((box, b) => ({ ...box, pageNumber: 1, pngBytes: signatureImages[b] })),
        });
        await conn.execute(
          "UPDATE mou_documents SET status = 'completed', signed_pdf_path = ?, completed_at = ? WHERE id = ?",
          [signedPdfPath, new Date(signedAt), mouId]
        );
        completedCount++;
      } else if (signedBoxes > 0) {
        await conn.execute("UPDATE mou_documents SET status = 'in_progress' WHERE id = ?", [mouId]);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  console.log(
    `Created ${MOU_COUNT} demo MOUs (${completedCount} completed, ${MOU_COUNT - completedCount} not fully signed) ` +
      `with ${signatureCount} signatures`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
