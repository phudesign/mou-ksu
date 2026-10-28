const { pool } = require('../config/db');

const ACTIONS = [
  'login',
  'login_failed',
  'mou_upload',
  'mou_update',
  'mou_delete',
  'signature_submit',
  'signature_reset',
  'user_create',
  'user_update',
  'user_reset_password',
  'profile_update',
  'profile_change_password',
];

/** Records an activity on [db] (pool or transaction connection). Throws if the write fails. */
async function recordActivity(
  db,
  { userId = null, action, targetType = null, targetId = null, details = null, ip = null }
) {
  await db.execute(
    `INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, action, targetType, targetId, details == null ? null : JSON.stringify(details), ip]
  );
}

/** Records an activity. Never throws: a failed audit write must not fail the main request. */
async function logActivity(entry) {
  try {
    await recordActivity(pool, entry);
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

module.exports = { ACTIONS, recordActivity, logActivity };
