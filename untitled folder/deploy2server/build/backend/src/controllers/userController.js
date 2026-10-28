const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { HttpError, ok, parseId } = require('../utils/http');
const { displayName } = require('../utils/userDisplay');
const { logActivity } = require('../services/auditService');

const ROLES = ['admin', 'signer'];
const USER_COLUMNS = 'id, username, fname, lname, `_role`, is_active, created_at';

function toUser(row) {
  return {
    id: row.id,
    username: row.username,
    fname: row.fname ?? null,
    lname: row.lname ?? null,
    fullName: displayName(row),
    role: row._role,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  };
}

function assertRole(role) {
  if (!ROLES.includes(role)) {
    throw new HttpError(400, `role must be one of: ${ROLES.join(', ')}`);
  }
}

function assertNamePart(value, field) {
  if (value !== null && (typeof value !== 'string' || value.length > 100)) {
    throw new HttpError(400, `${field} must be a string up to 100 chars`);
  }
}

function normalizeName(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

/** Placeholder hash — login uses LDAP; column remains NOT NULL. */
async function unusedPasswordHash() {
  return bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
}

async function findUser(id) {
  const [rows] = await pool.execute(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [id]);
  if (!rows[0]) throw new HttpError(404, 'User not found');
  return rows[0];
}

async function me(req, res) {
  ok(res, toUser(await findUser(req.user.id)));
}

async function list(req, res) {
  const [rows] = await pool.execute(`SELECT ${USER_COLUMNS} FROM users ORDER BY id`);
  ok(res, rows.map(toUser));
}

async function create(req, res) {
  const { username: rawUsername, fname, lname, role = 'signer' } = req.body || {};
  if (typeof rawUsername !== 'string') {
    throw new HttpError(400, 'username must be 3-100 chars: letters, digits, _ . -');
  }
  const username = rawUsername.trim();
  if (!/^[A-Za-z0-9_.-]{3,100}$/.test(username)) {
    throw new HttpError(400, 'username must be 3-100 chars: letters, digits, _ . -');
  }
  assertRole(role);
  if (fname !== undefined) assertNamePart(fname, 'fname');
  if (lname !== undefined) assertNamePart(lname, 'lname');

  const hash = await unusedPasswordHash();
  let result;
  try {
    [result] = await pool.execute(
      'INSERT INTO users (username, password, fname, lname, `_role`) VALUES (?, ?, ?, ?, ?)',
      [username, hash, normalizeName(fname) ?? null, normalizeName(lname) ?? null, role]
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'Username already exists');
    throw err;
  }

  await logActivity({
    userId: req.user.id,
    action: 'user_create',
    targetType: 'user',
    targetId: result.insertId,
    details: { username, role },
    ip: req.ip,
  });
  ok(res, toUser(await findUser(result.insertId)), 201);
}

/** Updates fname, lname, role and/or isActive. Admins cannot demote or disable themselves. */
async function update(req, res) {
  const id = parseId(req.params.id);
  await findUser(id);
  const { fname, lname, role, isActive } = req.body || {};

  const sets = [];
  const params = [];
  const changes = {};
  if (fname !== undefined) {
    assertNamePart(fname, 'fname');
    const normalized = normalizeName(fname);
    sets.push('fname = ?');
    params.push(normalized);
    changes.fname = normalized;
  }
  if (lname !== undefined) {
    assertNamePart(lname, 'lname');
    const normalized = normalizeName(lname);
    sets.push('lname = ?');
    params.push(normalized);
    changes.lname = normalized;
  }
  if (role !== undefined) {
    assertRole(role);
    if (id === req.user.id && role !== 'admin') {
      throw new HttpError(400, 'You cannot remove your own admin role');
    }
    sets.push('`_role` = ?');
    params.push(role);
    changes.role = role;
  }
  if (isActive !== undefined) {
    if (typeof isActive !== 'boolean') throw new HttpError(400, 'isActive must be a boolean');
    if (id === req.user.id && !isActive) {
      throw new HttpError(400, 'You cannot disable your own account');
    }
    sets.push('is_active = ?');
    params.push(isActive);
    changes.isActive = isActive;
  }
  if (!sets.length) throw new HttpError(400, 'Nothing to update');

  await pool.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);

  await logActivity({
    userId: req.user.id,
    action: 'user_update',
    targetType: 'user',
    targetId: id,
    details: changes,
    ip: req.ip,
  });
  ok(res, toUser(await findUser(id)));
}

module.exports = { me, list, create, update };
