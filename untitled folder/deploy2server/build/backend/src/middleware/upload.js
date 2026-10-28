const multer = require('multer');
const config = require('../config/env');
const { HttpError } = require('../utils/http');

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF

const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxFileSizeBytes, files: 1 },
}).single('file');

function requirePdfMagicBytes(req, res, next) {
  if (!req.file) {
    return next(new HttpError(400, 'PDF file is required (field "file")'));
  }
  if (!req.file.buffer.subarray(0, 4).equals(PDF_MAGIC)) {
    return next(new HttpError(400, 'File is not a valid PDF'));
  }
  next();
}

module.exports = { uploadPdf, requirePdfMagicBytes };
