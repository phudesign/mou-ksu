const multer = require('multer');
const config = require('../config/env');
const { HttpError } = require('../utils/http');

function notFound(req, res, next) {
  next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = 500;
  let message = 'Internal server error';

  if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = err.message;
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Invalid JSON body';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body too large';
  }

  if (status >= 500) {
    console.error(err);
    if (config.nodeEnv !== 'production') message = err.message;
  }

  res.status(status).json({ success: false, data: null, error: message });
}

module.exports = { notFound, errorHandler };
