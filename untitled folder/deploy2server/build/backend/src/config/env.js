const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters');
}

const backendRoot = path.join(__dirname, '../..');

function corsOrigin() {
  const origins = (process.env.CORS_ORIGIN || 'http://localhost:8080')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.length === 1 && origins[0] === '*') return '*';
  return origins;
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: required('DB_USER'),
    password: process.env.DB_PASS || '',
    database: required('DB_NAME'),
  },
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },
  upload: {
    dir: path.resolve(backendRoot, process.env.UPLOAD_DIR || './uploads'),
    maxFileSizeBytes: (Number(process.env.MAX_FILE_SIZE_MB) || 50) * 1024 * 1024,
  },
  corsOrigin: corsOrigin(),
  ldap: {
    apiUrl:
      process.env.LDAP_AUTH_API_URL ||
      'https://itservice.ksu.ac.th/api/ldap/ldap_auth_api.php',
    apiToken: process.env.LDAP_AUTH_API_TOKEN || '',
    origin: process.env.LDAP_AUTH_ORIGIN || 'https://mts.ksu.ac.th',
    verifySsl: (() => {
      const raw = process.env.LDAP_AUTH_VERIFY_SSL;
      if (raw === undefined || raw === '') return true;
      const lower = String(raw).trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(lower)) return true;
      if (['0', 'false', 'no', 'off'].includes(lower)) return false;
      const asInt = Number.parseInt(raw, 10);
      if (!Number.isNaN(asInt)) return Boolean(asInt);
      return true;
    })(),
  },
};
