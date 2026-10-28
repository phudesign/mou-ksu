class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data, error: null });
}

function parseId(value, name = 'id') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, `Invalid ${name}`);
  }
  return id;
}

/** Reads `?page=&limit=` with limit capped at 100. */
function parsePagination(query, defaultLimit) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

module.exports = { HttpError, ok, parseId, parsePagination };
