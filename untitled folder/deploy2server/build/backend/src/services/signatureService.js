const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { pool, withTransaction } = require('../config/db');
const { HttpError } = require('../utils/http');
const { DIRS, absUploadPath, writeUpload, removeFileQuietly } = require('../utils/files');
const { assertTransparentSignature } = require('../utils/signaturePng');
const { stampSignatures } = require('./pdfService');
const { logActivity, recordActivity } = require('./auditService');
const { USER_DISPLAY_SQL } = require('../utils/userDisplay');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PNG_BYTES = 1024 * 1024;
const MAX_USER_SIGNATURES = 3;

function decodePng(imageBase64) {
  if (typeof imageBase64 !== 'string' || !imageBase64) {
    throw new HttpError(400, 'imageBase64 is required');
  }
  const raw = imageBase64.replace(/^data:image\/png;base64,/, '');
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length > MAX_PNG_BYTES) throw new HttpError(413, 'Signature image is too large (max 1 MB)');
  if (bytes.length < PNG_MAGIC.length || !bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new HttpError(400, 'Signature must be a PNG image');
  }
  assertTransparentSignature(bytes);
  return bytes;
}

function newPngPath(dir) {
  return path.posix.join(dir, `${crypto.randomUUID()}.png`);
}

function mapSignatureRow(r, { effectivePrimaryId = null } = {}) {
  const isPrimaryStored = Boolean(r.is_primary);
  const isPrimary =
    effectivePrimaryId != null ? r.id === effectivePrimaryId : isPrimaryStored;
  return { id: r.id, createdAt: r.created_at, isPrimary };
}

/** Prefer explicit is_primary; otherwise newest signature is the effective primary. */
function resolveEffectivePrimaryId(rows) {
  if (!rows.length) return null;
  const marked = rows.find((r) => Boolean(r.is_primary));
  return (marked || rows[0]).id;
}

async function listUserSignatures(userId) {
  const [rows] = await pool.execute(
    'SELECT id, created_at, is_primary FROM user_signatures WHERE user_id = ? ORDER BY created_at DESC, id DESC',
    [userId]
  );
  const effectivePrimaryId = resolveEffectivePrimaryId(rows);
  return rows.map((r) => mapSignatureRow(r, { effectivePrimaryId }));
}

async function countUserSignatures(userId) {
  const [[{ total }]] = await pool.execute(
    'SELECT COUNT(*) AS total FROM user_signatures WHERE user_id = ?',
    [userId]
  );
  return Number(total);
}

async function saveUserSignature(userId, imageBase64) {
  const count = await countUserSignatures(userId);
  if (count >= MAX_USER_SIGNATURES) {
    throw new HttpError(400, `You can save at most ${MAX_USER_SIGNATURES} signatures`);
  }
  const isFirst = count === 0;
  const bytes = decodePng(imageBase64);
  const relPath = newPngPath(path.posix.join(DIRS.userSignatures, String(userId)));
  await writeUpload(relPath, bytes);
  try {
    const [result] = await pool.execute(
      'INSERT INTO user_signatures (user_id, image_path, is_primary) VALUES (?, ?, ?)',
      [userId, relPath, isFirst]
    );
    return { id: result.insertId, isPrimary: isFirst };
  } catch (err) {
    await removeFileQuietly(relPath);
    throw err;
  }
}

async function setPrimaryUserSignature(userId, signatureId) {
  await findUserSignature(userId, signatureId);
  await withTransaction(async (conn) => {
    await conn.execute('UPDATE user_signatures SET is_primary = FALSE WHERE user_id = ?', [userId]);
    const [result] = await conn.execute(
      'UPDATE user_signatures SET is_primary = TRUE WHERE id = ? AND user_id = ?',
      [signatureId, userId]
    );
    if (result.affectedRows === 0) throw new HttpError(404, 'Saved signature not found');
  });
  return { id: signatureId, isPrimary: true };
}

async function updateUserSignature(userId, signatureId, imageBase64) {
  const sig = await findUserSignature(userId, signatureId);
  const bytes = decodePng(imageBase64);
  const relPath = newPngPath(path.posix.join(DIRS.userSignatures, String(userId)));
  await writeUpload(relPath, bytes);
  try {
    await pool.execute('UPDATE user_signatures SET image_path = ? WHERE id = ?', [relPath, sig.id]);
  } catch (err) {
    await removeFileQuietly(relPath);
    throw err;
  }
  await removeFileQuietly(sig.image_path);
  return { id: sig.id };
}

async function findUserSignature(userId, signatureId) {
  const [rows] = await pool.execute(
    'SELECT id, image_path, is_primary FROM user_signatures WHERE id = ? AND user_id = ?',
    [signatureId, userId]
  );
  if (!rows[0]) throw new HttpError(404, 'Saved signature not found');
  return rows[0];
}

async function deleteUserSignature(userId, signatureId) {
  const sig = await findUserSignature(userId, signatureId);
  await pool.execute('DELETE FROM user_signatures WHERE id = ?', [sig.id]);
  await removeFileQuietly(sig.image_path);
}

async function stampCompletedMou(conn, mou) {
  const [rows] = await conn.execute(
    `SELECT b.page_number, b.pos_x, b.pos_y, b.width, b.height, s.signature_image_path
       FROM mou_signature_boxes b
       JOIN mou_signatures s ON s.box_id = b.id
      WHERE b.mou_id = ?`,
    [mou.id]
  );
  const stamps = await Promise.all(
    rows.map(async (r) => ({
      pageNumber: r.page_number,
      posX: r.pos_x,
      posY: r.pos_y,
      width: r.width,
      height: r.height,
      pngBytes: await fs.readFile(absUploadPath(r.signature_image_path)),
    }))
  );

  const relPath = path.posix.join(DIRS.signed, `mou_${mou.id}_${crypto.randomUUID()}.pdf`);
  await stampSignatures({
    sourcePath: absUploadPath(mou.pdf_path),
    outputPath: absUploadPath(relPath),
    stamps,
  });
  return relPath;
}

/**
 * Signs one box. Exactly one of imageBase64 / userSignatureId must be provided.
 * Signing is serialized per MOU (row lock on mou_documents) so the "all signed" check and
 * PDF stamping happen exactly once even when several signers submit at the same moment.
 */
async function submitSignature({ mouId, boxId, userId, imageBase64, userSignatureId, ipAddress }) {
  let pngBytes;
  let savedSignatureId = null;
  if (userSignatureId !== undefined && userSignatureId !== null) {
    const saved = await findUserSignature(userId, userSignatureId);
    pngBytes = await fs.readFile(absUploadPath(saved.image_path));
    savedSignatureId = saved.id;
  } else {
    pngBytes = decodePng(imageBase64);
  }

  const relPath = newPngPath(path.posix.join(DIRS.mouSignatures, String(mouId)));
  await writeUpload(relPath, pngBytes);

  let signedPdfPath = null;
  try {
    const result = await withTransaction(async (conn) => {
      const [[mou]] = await conn.execute(
        'SELECT id, pdf_path, status FROM mou_documents WHERE id = ? FOR UPDATE',
        [mouId]
      );
      if (!mou) throw new HttpError(404, 'MOU not found');
      if (mou.status === 'completed') throw new HttpError(409, 'MOU is already completed');

      const [[box]] = await conn.execute(
        'SELECT id, user_id, is_signed FROM mou_signature_boxes WHERE id = ? AND mou_id = ?',
        [boxId, mouId]
      );
      if (!box) throw new HttpError(404, 'Signature box not found in this MOU');
      if (box.user_id !== userId) throw new HttpError(403, 'This signature box belongs to another signer');
      if (box.is_signed) throw new HttpError(409, 'This box has already been signed');

      const [ins] = await conn.execute(
        `INSERT INTO mou_signatures
           (mou_id, box_id, user_id, user_signature_id, signature_image_path, ip_address)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [mouId, boxId, userId, savedSignatureId, relPath, ipAddress || null]
      );
      await conn.execute('UPDATE mou_signature_boxes SET is_signed = TRUE WHERE id = ?', [boxId]);

      const [[{ remaining }]] = await conn.execute(
        'SELECT COUNT(*) AS remaining FROM mou_signature_boxes WHERE mou_id = ? AND is_signed = FALSE',
        [mouId]
      );

      if (Number(remaining) === 0) {
        signedPdfPath = await stampCompletedMou(conn, mou);
        await conn.execute(
          `UPDATE mou_documents
              SET status = 'completed', signed_pdf_path = ?, completed_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
          [signedPdfPath, mouId]
        );
      } else {
        await conn.execute(
          "UPDATE mou_documents SET status = 'in_progress' WHERE id = ? AND status = 'pending'",
          [mouId]
        );
      }

      const [[sig]] = await conn.execute('SELECT signed_at FROM mou_signatures WHERE id = ?', [ins.insertId]);
      return {
        signatureId: ins.insertId,
        mouId,
        boxId,
        userId,
        signedAt: sig.signed_at,
        completed: Number(remaining) === 0,
      };
    });
    await logActivity({
      userId,
      action: 'signature_submit',
      targetType: 'mou',
      targetId: mouId,
      details: { boxId, completed: result.completed },
      ip: ipAddress || null,
    });
    return { ...result, pngBytes };
  } catch (err) {
    await removeFileQuietly(relPath);
    await removeFileQuietly(signedPdfPath);
    throw err;
  }
}

const MAX_RESET_REASON = 500;

function parseResetReason(raw) {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (!reason || reason.length > MAX_RESET_REASON) {
    throw new HttpError(400, `reason is required (max ${MAX_RESET_REASON} chars)`);
  }
  return reason;
}

/**
 * Admin-only: clears the signature on one box so its signer can sign again.
 * A completed MOU goes back to in progress and loses its signed PDF. The old signature image and
 * signed PDF stay on disk, and their paths are recorded in the audit log as evidence.
 */
async function resetSignature({ mouId, boxId, adminId, reason: rawReason, ipAddress }) {
  const reason = parseResetReason(rawReason);

  const reset = await withTransaction(async (conn) => {
    const [[mou]] = await conn.execute(
      'SELECT id, title, status, signed_pdf_path FROM mou_documents WHERE id = ? FOR UPDATE',
      [mouId]
    );
    if (!mou) throw new HttpError(404, 'MOU not found');

    const [[sig]] = await conn.execute(
      `SELECT s.id, s.user_id, s.signature_image_path, s.ip_address, s.signed_at,
              b.role_name, u.username, ${USER_DISPLAY_SQL} AS full_name
         FROM mou_signature_boxes b
         LEFT JOIN mou_signatures s ON s.box_id = b.id
         JOIN users u ON u.id = b.user_id
        WHERE b.id = ? AND b.mou_id = ?`,
      [boxId, mouId]
    );
    if (!sig) throw new HttpError(404, 'Signature box not found in this MOU');
    if (!sig.id) throw new HttpError(409, 'This box has not been signed yet');

    await conn.execute('DELETE FROM mou_signatures WHERE id = ?', [sig.id]);
    await conn.execute('UPDATE mou_signature_boxes SET is_signed = FALSE WHERE id = ?', [boxId]);

    const [[{ signed }]] = await conn.execute(
      'SELECT COUNT(*) AS signed FROM mou_signatures WHERE mou_id = ?',
      [mouId]
    );
    const status = Number(signed) === 0 ? 'pending' : 'in_progress';
    await conn.execute(
      'UPDATE mou_documents SET status = ?, signed_pdf_path = NULL, completed_at = NULL WHERE id = ?',
      [status, mouId]
    );

    // Inside the transaction: a reset without its audit record must not happen.
    await recordActivity(conn, {
      userId: adminId,
      action: 'signature_reset',
      targetType: 'mou',
      targetId: mouId,
      details: {
        title: mou.title,
        boxId,
        roleName: sig.role_name,
        signerId: sig.user_id,
        signerName: sig.full_name || sig.username,
        reason,
        signedAt: sig.signed_at,
        signedIp: sig.ip_address,
        previousStatus: mou.status,
        status,
        archivedSignaturePath: sig.signature_image_path,
        ...(mou.signed_pdf_path && { archivedSignedPdfPath: mou.signed_pdf_path }),
      },
      ip: ipAddress || null,
    });

    return { userId: sig.user_id, roleName: sig.role_name, status };
  });
  return { mouId, boxId, reason, ...reset };
}

/** Signature images and signed PDFs kept as evidence by reset/update for this MOU. */
async function listArchivedFiles(mouId) {
  const [rows] = await pool.execute(
    `SELECT details FROM audit_logs
      WHERE target_type = 'mou' AND target_id = ?
        AND action IN ('signature_reset', 'mou_update')`,
    [mouId]
  );
  return rows.flatMap((r) => {
    const d = typeof r.details === 'string' ? JSON.parse(r.details) : r.details;
    if (!d) return [];
    const paths = [d.archivedSignaturePath, d.archivedSignedPdfPath];
    if (Array.isArray(d.archivedSignaturePaths)) paths.push(...d.archivedSignaturePaths);
    return paths.filter(Boolean);
  });
}

async function getBoxSignatureImagePath(mouId, boxId) {
  const [rows] = await pool.execute(
    'SELECT signature_image_path FROM mou_signatures WHERE mou_id = ? AND box_id = ?',
    [mouId, boxId]
  );
  if (!rows[0]) throw new HttpError(404, 'Signature not found');
  return absUploadPath(rows[0].signature_image_path);
}

module.exports = {
  MAX_USER_SIGNATURES,
  listUserSignatures,
  saveUserSignature,
  setPrimaryUserSignature,
  updateUserSignature,
  findUserSignature,
  deleteUserSignature,
  submitSignature,
  resetSignature,
  listArchivedFiles,
  getBoxSignatureImagePath,
};
