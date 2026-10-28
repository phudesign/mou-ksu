const fs = require('fs/promises');
const path = require('path');
const config = require('../config/env');
const { HttpError } = require('./http');

const DIRS = {
  pdfs: 'pdfs',
  signed: 'signed',
  mouSignatures: 'signatures/mou',
  userSignatures: 'signatures/users',
};

function absUploadPath(relPath) {
  const abs = path.resolve(config.upload.dir, relPath);
  if (!abs.startsWith(config.upload.dir + path.sep)) {
    throw new HttpError(500, 'Invalid stored file path');
  }
  return abs;
}

async function writeUpload(relPath, data) {
  const abs = absUploadPath(relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data);
  return abs;
}

async function removeFileQuietly(relPath) {
  if (!relPath) return;
  try {
    await fs.unlink(absUploadPath(relPath));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Failed to delete ${relPath}:`, err.message);
  }
}

async function ensureUploadDirs() {
  for (const dir of Object.values(DIRS)) {
    await fs.mkdir(absUploadPath(dir), { recursive: true });
  }
}

module.exports = { DIRS, absUploadPath, writeUpload, removeFileQuietly, ensureUploadDirs };
