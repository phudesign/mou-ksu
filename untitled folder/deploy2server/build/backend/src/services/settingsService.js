const { pool } = require('../config/db');
const { HttpError } = require('../utils/http');

const SIGNING_MODES = ['primary', 'classic'];
const DEFAULT_SIGNING_MODE = 'primary';

async function getSetting(key, defaultValue = null) {
  const [rows] = await pool.execute(
    'SELECT setting_value FROM app_settings WHERE setting_key = ?',
    [key]
  );
  if (!rows[0]) return defaultValue;
  return rows[0].setting_value;
}

async function setSetting(key, value) {
  await pool.execute(
    `INSERT INTO app_settings (setting_key, setting_value)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, value]
  );
}

async function getSigningMode() {
  const value = await getSetting('signing_mode', DEFAULT_SIGNING_MODE);
  return SIGNING_MODES.includes(value) ? value : DEFAULT_SIGNING_MODE;
}

async function getPublicSettings() {
  return { signingMode: await getSigningMode() };
}

async function getAdminSettings() {
  return getPublicSettings();
}

async function updateAdminSettings({ signingMode }) {
  if (signingMode === undefined) {
    throw new HttpError(400, 'No settings to update');
  }
  if (!SIGNING_MODES.includes(signingMode)) {
    throw new HttpError(400, `signingMode must be one of: ${SIGNING_MODES.join(', ')}`);
  }
  await setSetting('signing_mode', signingMode);
  return getAdminSettings();
}

module.exports = {
  SIGNING_MODES,
  DEFAULT_SIGNING_MODE,
  getSigningMode,
  getPublicSettings,
  getAdminSettings,
  updateAdminSettings,
};
