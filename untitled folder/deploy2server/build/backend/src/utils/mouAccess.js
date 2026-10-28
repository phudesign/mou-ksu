const { pool } = require('../config/db');
const { HttpError } = require('./http');

const VISIBILITIES = ['public', 'private'];

function parseVisibility(raw, { required = false } = {}) {
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new HttpError(400, 'visibility is required');
    return undefined;
  }
  if (!VISIBILITIES.includes(raw)) {
    throw new HttpError(400, `visibility must be one of: ${VISIBILITIES.join(', ')}`);
  }
  return raw;
}

function isAdmin(user) {
  return user?.role === 'admin';
}

/** SQL fragment + params so a non-admin only sees public MOUs or ones they are assigned to. */
function visibilityFilterSql(user, { alias = 'm' } = {}) {
  if (isAdmin(user)) return { sql: '', params: [] };
  return {
    sql: `(${alias}.visibility = 'public' OR EXISTS (
      SELECT 1 FROM mou_signature_boxes _vb
       WHERE _vb.mou_id = ${alias}.id AND _vb.user_id = ?
    ))`,
    params: [user.id],
  };
}

async function isAssignedSigner(mouId, userId) {
  const [rows] = await pool.execute(
    'SELECT 1 FROM mou_signature_boxes WHERE mou_id = ? AND user_id = ? LIMIT 1',
    [mouId, userId]
  );
  return rows.length > 0;
}

/**
 * Admin, public MOU, or assigned signer may access.
 * Throws HttpError(403) when denied. Returns true when allowed.
 */
async function assertCanAccessMou(user, mou) {
  if (isAdmin(user)) return true;
  if (mou.visibility === 'public') return true;
  if (await isAssignedSigner(mou.id, user.id)) return true;
  throw new HttpError(403, 'You do not have access to this MOU');
}

async function canAccessMou(user, mou) {
  try {
    await assertCanAccessMou(user, mou);
    return true;
  } catch (err) {
    if (err instanceof HttpError && err.status === 403) return false;
    throw err;
  }
}

module.exports = {
  VISIBILITIES,
  parseVisibility,
  isAdmin,
  visibilityFilterSql,
  isAssignedSigner,
  assertCanAccessMou,
  canAccessMou,
};
