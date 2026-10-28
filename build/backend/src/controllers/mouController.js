const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { pool, withTransaction } = require('../config/db');
const { HttpError, ok, parseId, parsePagination } = require('../utils/http');
const { DIRS, absUploadPath, writeUpload, removeFileQuietly } = require('../utils/files');
const { logActivity } = require('../services/auditService');
const { listArchivedFiles } = require('../services/signatureService');
const { USER_DISPLAY_SQL } = require('../utils/userDisplay');
const { parseVisibility, visibilityFilterSql, assertCanAccessMou } = require('../utils/mouAccess');

const STATUSES = ['pending', 'in_progress', 'completed'];

function toMouSummary(row) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    visibility: row.visibility || 'private',
    createdBy: row.created_by,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    totalBoxes: Number(row.total_boxes),
    signedBoxes: Number(row.signed_boxes),
    hasSignedPdf: Boolean(row.signed_pdf_path),
  };
}

function toBox(row, resetReasons = new Map()) {
  const isSigned = Boolean(row.is_signed);
  return {
    id: row.id,
    userId: row.user_id,
    signerName: row.full_name,
    roleName: row.role_name,
    pageNumber: row.page_number,
    posX: row.pos_x,
    posY: row.pos_y,
    width: row.width,
    height: row.height,
    isSigned,
    resetReason: isSigned ? null : (resetReasons.get(row.id) ?? null),
  };
}

/** boxId -> reason of the latest signature_reset, so a signer sees why they must sign again. */
async function loadResetReasons(mouId) {
  const [rows] = await pool.execute(
    `SELECT details FROM audit_logs
      WHERE action = 'signature_reset' AND target_type = 'mou' AND target_id = ?
      ORDER BY created_at, id`,
    [mouId]
  );
  const reasons = new Map();
  for (const r of rows) {
    const d = typeof r.details === 'string' ? JSON.parse(r.details) : r.details;
    if (d?.boxId) reasons.set(d.boxId, d.reason ?? null);
  }
  return reasons;
}

async function findMou(id) {
  const [rows] = await pool.execute(
    `SELECT m.id, m.title, m.status, m.visibility, m.pdf_path, m.signed_pdf_path, m.created_by, m.created_at,
            m.completed_at, COUNT(b.id) AS total_boxes, COALESCE(SUM(b.is_signed), 0) AS signed_boxes
       FROM mou_documents m
       LEFT JOIN mou_signature_boxes b ON b.mou_id = m.id
      WHERE m.id = ?
      GROUP BY m.id`,
    [id]
  );
  if (!rows[0]) throw new HttpError(404, 'MOU not found');
  return rows[0];
}

/** Loads MOU and throws 403 if the current user may not access it. */
async function findAccessibleMou(req, id) {
  const mou = await findMou(id);
  await assertCanAccessMou(req.user, mou);
  return mou;
}

async function list(req, res) {
  const { page, limit, offset } = parsePagination(req.query, 20);

  const where = [];
  const params = [];
  const { status, q } = req.query;
  if (status !== undefined && status !== '') {
    if (!STATUSES.includes(status)) {
      throw new HttpError(400, `status must be one of: ${STATUSES.join(', ')}`);
    }
    where.push('m.status = ?');
    params.push(status);
  }
  if (typeof q === 'string' && q.trim()) {
    where.push('m.title LIKE ?');
    params.push(`%${q.trim().replace(/[\\%_]/g, '\\$&')}%`);
  }
  const vis = visibilityFilterSql(req.user);
  if (vis.sql) {
    where.push(vis.sql);
    params.push(...vis.params);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // pool.query (client-side escaping) because MySQL prepared statements reject numeric LIMIT/OFFSET params.
  const [rows] = await pool.query(
    `SELECT m.id, m.title, m.status, m.visibility, m.signed_pdf_path, m.created_by, m.created_at, m.completed_at,
            COUNT(b.id) AS total_boxes, COALESCE(SUM(b.is_signed), 0) AS signed_boxes
       FROM mou_documents m
       LEFT JOIN mou_signature_boxes b ON b.mou_id = m.id
      ${whereSql}
      GROUP BY m.id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM mou_documents m ${whereSql}`,
    params
  );

  ok(res, {
    items: rows.map(toMouSummary),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

async function loadMouDetail(id) {
  const mou = await findMou(id);
  const [boxes] = await pool.execute(
    `SELECT b.id, b.user_id, ${USER_DISPLAY_SQL} AS full_name, b.role_name, b.page_number,
            b.pos_x, b.pos_y, b.width, b.height, b.is_signed
       FROM mou_signature_boxes b
       JOIN users u ON u.id = b.user_id
      WHERE b.mou_id = ?
      ORDER BY b.page_number, b.id`,
    [id]
  );
  const resetReasons = await loadResetReasons(id);
  return { ...toMouSummary(mou), boxes: boxes.map((b) => toBox(b, resetReasons)) };
}

async function getById(req, res) {
  const id = parseId(req.params.id);
  await findAccessibleMou(req, id);
  ok(res, await loadMouDetail(id));
}

async function getPdf(req, res) {
  const id = parseId(req.params.id);
  const mou = await findAccessibleMou(req, id);
  res.type('application/pdf');
  res.sendFile(absUploadPath(mou.pdf_path));
}

async function getSignedPdf(req, res) {
  const id = parseId(req.params.id);
  const mou = await findAccessibleMou(req, id);
  if (!mou.signed_pdf_path) throw new HttpError(404, 'MOU has not been fully signed yet');
  res.type('application/pdf');
  res.sendFile(absUploadPath(mou.signed_pdf_path));
}

function isPercent(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;
}

function parseBoxes(raw, pageCount) {
  if (raw === undefined || raw === '') return [];
  let boxes;
  try {
    boxes = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new HttpError(400, 'boxes must be a JSON array');
  }
  if (!Array.isArray(boxes)) throw new HttpError(400, 'boxes must be a JSON array');

  return boxes.map((b, i) => {
    const where = `boxes[${i}]`;
    if (!b || typeof b !== 'object') throw new HttpError(400, `${where} must be an object`);
    const { userId, roleName = null, pageNumber, posX, posY, width, height } = b;
    if (!Number.isInteger(userId) || userId <= 0) throw new HttpError(400, `${where}.userId is invalid`);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
      throw new HttpError(400, `${where}.pageNumber must be between 1 and ${pageCount}`);
    }
    if (![posX, posY, width, height].every(isPercent) || width === 0 || height === 0) {
      throw new HttpError(400, `${where} posX/posY/width/height must be percentages (0-100)`);
    }
    if (posX + width > 100.001 || posY + height > 100.001) {
      throw new HttpError(400, `${where} extends outside the page`);
    }
    if (roleName !== null && (typeof roleName !== 'string' || roleName.length > 100)) {
      throw new HttpError(400, `${where}.roleName must be a string up to 100 chars`);
    }
    return { userId, roleName, pageNumber, posX, posY, width, height };
  });
}

function parseTitle(raw) {
  const title = typeof raw === 'string' ? raw.trim() : '';
  if (!title || title.length > 300) {
    throw new HttpError(400, 'title is required (max 300 chars)');
  }
  return title;
}

async function getPageCount(pdfBytes) {
  try {
    const pdf = await PDFDocument.load(pdfBytes);
    return pdf.getPageCount();
  } catch {
    throw new HttpError(400, 'PDF could not be parsed (corrupted or encrypted)');
  }
}

async function assertUsersExist(boxes) {
  const userIds = [...new Set(boxes.map((b) => b.userId))];
  if (!userIds.length) return;
  const [found] = await pool.query('SELECT id FROM users WHERE id IN (?) AND is_active = TRUE', [userIds]);
  const missing = userIds.filter((uid) => !found.some((r) => r.id === uid));
  if (missing.length) throw new HttpError(400, `Unknown or inactive userId(s): ${missing.join(', ')}`);
}

async function insertBoxes(conn, mouId, boxes) {
  for (const b of boxes) {
    await conn.execute(
      `INSERT INTO mou_signature_boxes
         (mou_id, user_id, role_name, page_number, pos_x, pos_y, width, height)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [mouId, b.userId, b.roleName, b.pageNumber, b.posX, b.posY, b.width, b.height]
    );
  }
}

async function upload(req, res) {
  const title = parseTitle(req.body.title);
  const visibility = parseVisibility(req.body.visibility) ?? 'private';
  const pageCount = await getPageCount(req.file.buffer);
  const boxes = parseBoxes(req.body.boxes, pageCount);
  await assertUsersExist(boxes);

  const relPath = path.posix.join(DIRS.pdfs, `${crypto.randomUUID()}.pdf`);
  await writeUpload(relPath, req.file.buffer);

  let mouId;
  try {
    mouId = await withTransaction(async (conn) => {
      const [result] = await conn.execute(
        'INSERT INTO mou_documents (title, pdf_path, visibility, created_by) VALUES (?, ?, ?, ?)',
        [title, relPath, visibility, req.user.id]
      );
      await insertBoxes(conn, result.insertId, boxes);
      return result.insertId;
    });
  } catch (err) {
    await removeFileQuietly(relPath);
    throw err;
  }

  await logActivity({
    userId: req.user.id,
    action: 'mou_upload',
    targetType: 'mou',
    targetId: mouId,
    details: { title, visibility, boxes: boxes.length },
    ip: req.ip,
  });
  ok(res, await loadMouDetail(mouId), 201);
}

/** Updates title, visibility, and/or replaces all signature boxes.
 *  Replacing boxes clears existing signatures and resets status to pending. */
async function update(req, res) {
  const id = parseId(req.params.id);
  const mou = await findMou(id);
  const { title: rawTitle, boxes: rawBoxes, visibility: rawVisibility } = req.body || {};

  const title = rawTitle === undefined ? undefined : parseTitle(rawTitle);
  const visibility = parseVisibility(rawVisibility);
  let boxes;
  if (rawBoxes !== undefined) {
    if (!Array.isArray(rawBoxes)) throw new HttpError(400, 'boxes must be an array');
    const pageCount = await getPageCount(await fs.readFile(absUploadPath(mou.pdf_path)));
    boxes = parseBoxes(rawBoxes, pageCount);
    await assertUsersExist(boxes);
  }

  let clearedSignatures = 0;
  let archivedSignaturePaths = [];
  let archivedSignedPdfPath = null;
  let previousStatus = mou.status;

  await withTransaction(async (conn) => {
    const [[locked]] = await conn.execute(
      'SELECT status, signed_pdf_path FROM mou_documents WHERE id = ? FOR UPDATE',
      [id]
    );
    previousStatus = locked.status;

    if (title !== undefined) {
      await conn.execute('UPDATE mou_documents SET title = ? WHERE id = ?', [title, id]);
    }
    if (visibility !== undefined) {
      await conn.execute('UPDATE mou_documents SET visibility = ? WHERE id = ?', [visibility, id]);
    }
    if (boxes !== undefined) {
      const [sigRows] = await conn.execute(
        'SELECT signature_image_path FROM mou_signatures WHERE mou_id = ?',
        [id]
      );
      clearedSignatures = sigRows.length;
      archivedSignaturePaths = sigRows.map((s) => s.signature_image_path).filter(Boolean);
      archivedSignedPdfPath = locked.signed_pdf_path || null;

      await conn.execute('DELETE FROM mou_signature_boxes WHERE mou_id = ?', [id]);
      await insertBoxes(conn, id, boxes);
      await conn.execute(
        'UPDATE mou_documents SET status = ?, signed_pdf_path = NULL, completed_at = NULL WHERE id = ?',
        ['pending', id]
      );
    }
  });

  await logActivity({
    userId: req.user.id,
    action: 'mou_update',
    targetType: 'mou',
    targetId: id,
    details: {
      ...(title !== undefined && { title }),
      ...(visibility !== undefined && { visibility }),
      ...(boxes !== undefined && { boxes: boxes.length }),
      ...(clearedSignatures > 0 && {
        clearedSignatures,
        previousStatus,
        archivedSignaturePaths,
        ...(archivedSignedPdfPath && { archivedSignedPdfPath }),
      }),
    },
    ip: req.ip,
  });
  ok(res, await loadMouDetail(id));
}

async function remove(req, res) {
  const id = parseId(req.params.id);
  const mou = await findMou(id);
  const [sigs] = await pool.execute(
    'SELECT signature_image_path FROM mou_signatures WHERE mou_id = ?',
    [id]
  );
  const archived = await listArchivedFiles(id);

  await pool.execute('DELETE FROM mou_documents WHERE id = ?', [id]);

  await removeFileQuietly(mou.pdf_path);
  await removeFileQuietly(mou.signed_pdf_path);
  for (const s of sigs) await removeFileQuietly(s.signature_image_path);
  for (const f of archived) await removeFileQuietly(f);

  await logActivity({
    userId: req.user.id,
    action: 'mou_delete',
    targetType: 'mou',
    targetId: id,
    details: { title: mou.title, status: mou.status },
    ip: req.ip,
  });
  ok(res, { id });
}

async function audit(req, res) {
  const id = parseId(req.params.id);
  const mou = await findAccessibleMou(req, id);
  const [rows] = await pool.execute(
    `SELECT s.id, s.box_id, b.role_name, s.user_id, u.username, ${USER_DISPLAY_SQL} AS full_name,
            s.ip_address, s.signed_at
       FROM mou_signatures s
       JOIN users u ON u.id = s.user_id
       JOIN mou_signature_boxes b ON b.id = s.box_id
      WHERE s.mou_id = ?
      ORDER BY s.signed_at, s.id`,
    [id]
  );
  const [resets] = await pool.execute(
    `SELECT l.id, l.details, l.ip_address, l.created_at, u.username, ${USER_DISPLAY_SQL} AS full_name
       FROM audit_logs l
       LEFT JOIN users u ON u.id = l.user_id
      WHERE l.action = 'signature_reset' AND l.target_type = 'mou' AND l.target_id = ?
      ORDER BY l.created_at DESC, l.id DESC`,
    [id]
  );

  ok(res, {
    mou: toMouSummary(mou),
    signatures: rows.map((r) => ({
      id: r.id,
      boxId: r.box_id,
      roleName: r.role_name,
      userId: r.user_id,
      username: r.username,
      fullName: r.full_name,
      ipAddress: r.ip_address,
      signedAt: r.signed_at,
    })),
    resets: resets.map((r) => {
      const d = (typeof r.details === 'string' ? JSON.parse(r.details) : r.details) || {};
      return {
        id: r.id,
        boxId: d.boxId ?? null,
        roleName: d.roleName ?? null,
        signerName: d.signerName ?? null,
        reason: d.reason ?? null,
        signedAt: d.signedAt ?? null,
        resetBy: r.full_name || r.username || null,
        ipAddress: r.ip_address,
        resetAt: r.created_at,
      };
    }),
  });
}

module.exports = { list, getById, getPdf, getSignedPdf, upload, update, remove, audit, findMou, findAccessibleMou };
