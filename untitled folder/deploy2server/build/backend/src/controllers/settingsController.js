const settingsService = require('../services/settingsService');
const { ok } = require('../utils/http');

async function getSigningMode(req, res) {
  ok(res, await settingsService.getPublicSettings());
}

module.exports = { getSigningMode };
