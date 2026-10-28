const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const config = require('../config/env');
const { HttpError, ok } = require('../utils/http');
const { displayName } = require('../utils/userDisplay');
const { logActivity } = require('../services/auditService');
const { authLdap } = require('../services/ldapAuth');

async function login(req, res) {
  const { username: rawUsername, password } = req.body || {};
  if (typeof rawUsername !== 'string' || typeof password !== 'string' || !rawUsername || !password) {
    throw new HttpError(400, 'username and password are required');
  }
  const username = rawUsername.trim();
  if (!username) {
    throw new HttpError(400, 'username and password are required');
  }

  const ldap = await authLdap(username, password);

  if (!ldap.ok) {
    const gatewayDown = ldap.httpCode == null
      || (ldap.httpCode >= 500)
      || (typeof ldap.reason === 'string' && /not configured|timed out|request failed|not valid JSON|not a JSON object/i.test(ldap.reason));
    await logActivity({
      userId: null,
      action: 'login_failed',
      details: {
        username: username.slice(0, 100),
        reason: gatewayDown ? 'ldap_unavailable' : 'ldap_rejected',
      },
      ip: req.ip,
    });
    if (gatewayDown) {
      throw new HttpError(503, 'Authentication service unavailable');
    }
    throw new HttpError(401, 'Invalid username or password');
  }

  if (!ldap.authenticated) {
    await logActivity({
      userId: null,
      action: 'login_failed',
      details: { username: username.slice(0, 100), reason: 'ldap_rejected' },
      ip: req.ip,
    });
    throw new HttpError(401, 'Invalid username or password');
  }

  const [rows] = await pool.execute(
    'SELECT id, username, fname, lname, `_role`, is_active FROM users WHERE username = ?',
    [username]
  );
  const user = rows[0];
  if (!user) {
    await logActivity({
      userId: null,
      action: 'login_failed',
      details: { username: username.slice(0, 100), reason: 'not_registered' },
      ip: req.ip,
    });
    throw new HttpError(403, 'Account is not registered');
  }
  if (!user.is_active) {
    await logActivity({
      userId: user.id,
      action: 'login_failed',
      details: { reason: 'inactive' },
      ip: req.ip,
    });
    throw new HttpError(403, 'Account is disabled');
  }

  await logActivity({ userId: user.id, action: 'login', ip: req.ip });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user._role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  ok(res, {
    token,
    user: {
      id: user.id,
      username: user.username,
      fname: user.fname ?? null,
      lname: user.lname ?? null,
      fullName: displayName(user),
      role: user._role,
    },
  });
}

module.exports = { login };
