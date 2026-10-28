const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { pool } = require('../config/db');
const { HttpError } = require('../utils/http');
const { displayName } = require('../utils/userDisplay');

function verifyToken(token) {
  const payload = jwt.verify(token, config.jwt.secret);
  return { id: payload.id, username: payload.username, role: payload.role };
}

/**
 * Verifies the token and reloads role/active status from the DB so role changes and
 * deactivation take effect immediately instead of when the token expires.
 * Throws HttpError(401) for an invalid token or a missing/disabled user.
 */
async function authenticateToken(token) {
  let tokenUser;
  try {
    tokenUser = verifyToken(token);
  } catch {
    throw new HttpError(401, 'Invalid token');
  }
  const [rows] = await pool.execute(
    'SELECT id, username, fname, lname, `_role`, is_active FROM users WHERE id = ?',
    [tokenUser.id]
  );
  const user = rows[0];
  if (!user || !user.is_active) throw new HttpError(401, 'Account is disabled');
  return {
    id: user.id,
    username: user.username,
    fname: user.fname ?? null,
    lname: user.lname ?? null,
    fullName: displayName(user),
    role: user._role,
  };
}

async function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new HttpError(401, 'No token'));
  }
  try {
    req.user = await authenticateToken(token);
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new HttpError(403, 'Forbidden'));
    }
    next();
  };
}

module.exports = { authenticate, authenticateToken, requireRole, verifyToken };
