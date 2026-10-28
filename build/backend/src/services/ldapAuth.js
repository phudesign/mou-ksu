const http = require('http');
const https = require('https');
const { URL } = require('url');
const config = require('../config/env');

const TIMEOUT_MS = 20_000;

const SUCCESS_STRINGS = new Set(['success', 'ok', 'true', 'authenticated', 'valid', 'pass', 'passed']);

/**
 * Fail-closed: credentials count as accepted only when the JSON body
 * clearly signals success (status / success / result / authenticated / auth).
 */
function isAuthenticatedPayload(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return false;

  const candidates = [data.status, data.success, data.result, data.authenticated, data.auth];
  for (const value of candidates) {
    if (value === true || value === 1) return true;
    if (typeof value === 'string' && SUCCESS_STRINGS.has(value.trim().toLowerCase())) return true;
  }

  if (data.data !== undefined && data.data !== data) {
    return isAuthenticatedPayload(data.data);
  }
  return false;
}

/**
 * Calls the KSU LDAP auth HTTP gateway (same contract as the legacy PHP client).
 * Never logs passwords. Returns a debug-friendly payload for the test page.
 *
 * - ok: gateway returned HTTP 2xx with a JSON object (transport layer)
 * - authenticated: body clearly indicates accepted credentials (fail-closed)
 */
async function authLdap(username, password) {
  const { apiUrl, apiToken, origin, verifySsl } = config.ldap;

  if (!apiToken) {
    return {
      ok: false,
      authenticated: false,
      reason: 'LDAP_AUTH_API_TOKEN is not configured',
      httpCode: null,
      data: null,
      rawBody: null,
    };
  }

  const body = JSON.stringify({
    username,
    password,
    token: apiToken,
  });

  let httpCode;
  let rawBody;
  try {
    ({ httpCode, rawBody } = await postJson(apiUrl, {
      body,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: origin,
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0 (compatible; MTS-KSU-API/1.0)',
        'Content-Length': Buffer.byteLength(body),
      },
      timeoutMs: TIMEOUT_MS,
      verifySsl,
    }));
  } catch (err) {
    return {
      ok: false,
      authenticated: false,
      reason: err.code === 'ETIMEDOUT' || err.message === 'timeout'
        ? 'LDAP request timed out'
        : `LDAP request failed: ${err.message || String(err)}`,
      httpCode: null,
      data: null,
      rawBody: null,
    };
  }

  if (httpCode < 200 || httpCode >= 300) {
    let data = null;
    try {
      data = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      data = null;
    }
    return {
      ok: false,
      authenticated: false,
      reason: `LDAP API returned HTTP ${httpCode}`,
      httpCode,
      data,
      rawBody,
    };
  }

  let data = null;
  try {
    data = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return {
      ok: false,
      authenticated: false,
      reason: 'LDAP API response was not valid JSON',
      httpCode,
      data: null,
      rawBody,
    };
  }

  if (data === null || typeof data !== 'object') {
    return {
      ok: false,
      authenticated: false,
      reason: 'LDAP API response was not a JSON object',
      httpCode,
      data,
      rawBody,
    };
  }

  const authenticated = isAuthenticatedPayload(data);
  return {
    ok: true,
    authenticated,
    reason: authenticated ? null : 'LDAP credentials were not accepted',
    httpCode,
    data,
    rawBody,
  };
}

function postJson(url, { body, headers, timeoutMs, verifySsl }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(err);
      return;
    }

    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers,
        timeout: timeoutMs,
        rejectUnauthorized: verifySsl,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            httpCode: res.statusCode || 0,
            rawBody: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      const err = new Error('timeout');
      err.code = 'ETIMEDOUT';
      reject(err);
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { authLdap, isAuthenticatedPayload };
