const { pool } = require('../config/db');
const { HttpError, ok, parseId, parsePagination } = require('../utils/http');
const { ACTIONS } = require('../services/auditService');
const { USER_DISPLAY_SQL } = require('../utils/userDisplay');
const { authLdap } = require('../services/ldapAuth');
const settingsService = require('../services/settingsService');

async function stats(req, res) {
  const [statusRows] = await pool.execute(
    'SELECT status, COUNT(*) AS count FROM mou_documents GROUP BY status'
  );
  const mou = { total: 0, pending: 0, inProgress: 0, completed: 0 };
  for (const r of statusRows) {
    const count = Number(r.count);
    mou.total += count;
    if (r.status === 'pending') mou.pending = count;
    else if (r.status === 'in_progress') mou.inProgress = count;
    else if (r.status === 'completed') mou.completed = count;
  }

  const [[userRow]] = await pool.execute(
    "SELECT COUNT(*) AS total, COALESCE(SUM(is_active), 0) AS active, "
      + "COALESCE(SUM(`_role` = 'admin'), 0) AS admins FROM users"
  );

  ok(res, {
    mou,
    users: { total: Number(userRow.total), active: Number(userRow.active), admins: Number(userRow.admins) },
  });
}

/**
 * Like parsePagination, but clamps the page to the last one so a list that shrank between
 * refreshes (e.g. a MOU got its last signature) still returns rows instead of an empty page.
 */
async function clampedPagination(query, defaultLimit, countSql, countParams = []) {
  const { page, limit } = parsePagination(query, defaultLimit);
  const [[{ total }]] = await pool.query(countSql, countParams);
  const totalPages = Math.ceil(total / limit);
  const current = Math.max(1, Math.min(page, totalPages));
  return { page: current, limit, offset: (current - 1) * limit, total, totalPages };
}

const AWAITING_STATUSES = ['pending', 'in_progress'];

/** MOUs not fully signed. Filters: q (title), status (pending/in_progress), signerId (still has to sign). */
async function awaitingMous(req, res) {
  const where = ["m.status <> 'completed'"];
  const params = [];
  const { q, status, signerId } = req.query;
  if (status !== undefined && status !== '') {
    if (!AWAITING_STATUSES.includes(status)) {
      throw new HttpError(400, `status must be one of: ${AWAITING_STATUSES.join(', ')}`);
    }
    where.push('m.status = ?');
    params.push(status);
  }
  if (typeof q === 'string' && q.trim()) {
    where.push('m.title LIKE ?');
    params.push(`%${q.trim().replace(/[\\%_]/g, '\\$&')}%`);
  }
  if (signerId !== undefined && signerId !== '') {
    where.push(
      'EXISTS (SELECT 1 FROM mou_signature_boxes p WHERE p.mou_id = m.id AND p.user_id = ? AND p.is_signed = FALSE)'
    );
    params.push(parseId(signerId, 'signerId'));
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const { page, limit, offset, total, totalPages } = await clampedPagination(
    req.query,
    10,
    `SELECT COUNT(*) AS total FROM mou_documents m ${whereSql}`,
    params
  );
  // pool.query (client-side escaping) because MySQL prepared statements reject numeric LIMIT/OFFSET params.
  const [rows] = await pool.query(
    `SELECT m.id, m.title, m.status, m.created_at,
            COUNT(b.id) AS total_boxes, COALESCE(SUM(b.is_signed), 0) AS signed_boxes
       FROM mou_documents m
       LEFT JOIN mou_signature_boxes b ON b.mou_id = m.id
      ${whereSql}
      GROUP BY m.id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  ok(res, {
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      createdAt: r.created_at,
      totalBoxes: Number(r.total_boxes),
      signedBoxes: Number(r.signed_boxes),
    })),
    pagination: { page, limit, total, totalPages },
  });
}

async function recentSignatures(req, res) {
  const { page, limit, offset, total, totalPages } = await clampedPagination(
    req.query,
    10,
    'SELECT COUNT(*) AS total FROM mou_signatures'
  );
  const [rows] = await pool.query(
    `SELECT s.id, s.mou_id, m.title, b.role_name, ${USER_DISPLAY_SQL} AS full_name, u.username, s.signed_at
       FROM mou_signatures s
       JOIN mou_documents m ON m.id = s.mou_id
       JOIN mou_signature_boxes b ON b.id = s.box_id
       JOIN users u ON u.id = s.user_id
      ORDER BY s.signed_at DESC, s.id DESC
      LIMIT ? OFFSET ?`,
    [limit, offset]
  );

  ok(res, {
    items: rows.map((r) => ({
      id: r.id,
      mouId: r.mou_id,
      mouTitle: r.title,
      roleName: r.role_name,
      fullName: r.full_name,
      username: r.username,
      signedAt: r.signed_at,
    })),
    pagination: { page, limit, total, totalPages },
  });
}

async function activityLogs(req, res) {
  const { page, limit, offset } = parsePagination(req.query, 50);

  const where = [];
  const params = [];
  const { action, userId } = req.query;
  if (action !== undefined && action !== '') {
    if (!ACTIONS.includes(action)) throw new HttpError(400, `action must be one of: ${ACTIONS.join(', ')}`);
    where.push('l.action = ?');
    params.push(action);
  }
  if (userId !== undefined && userId !== '') {
    where.push('l.user_id = ?');
    params.push(parseId(userId, 'userId'));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // pool.query (client-side escaping) because MySQL prepared statements reject numeric LIMIT/OFFSET params.
  const [rows] = await pool.query(
    `SELECT l.id, l.user_id, u.username, ${USER_DISPLAY_SQL} AS full_name, l.action, l.target_type, l.target_id,
            l.details, l.ip_address, l.created_at
       FROM audit_logs l
       LEFT JOIN users u ON u.id = l.user_id
      ${whereSql}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM audit_logs l ${whereSql}`, params);

  ok(res, {
    items: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username,
      fullName: r.full_name,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      details: typeof r.details === 'string' ? JSON.parse(r.details) : r.details,
      ipAddress: r.ip_address,
      createdAt: r.created_at,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

/** Admin-only LDAP gateway probe — does not create a session or touch users. */
async function ldapTest(req, res) {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    throw new HttpError(400, 'username and password are required');
  }
  const result = await authLdap(username, password);
  ok(res, result);
}

async function getSettings(req, res) {
  ok(res, await settingsService.getAdminSettings());
}

async function updateSettings(req, res) {
  ok(res, await settingsService.updateAdminSettings(req.body || {}));
}

module.exports = {
  stats,
  awaitingMous,
  recentSignatures,
  activityLogs,
  ldapTest,
  getSettings,
  updateSettings,
};
