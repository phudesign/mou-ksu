const fs = require('fs/promises');
const signatureService = require('../services/signatureService');
const socketService = require('../services/socketService');
const mouController = require('./mouController');
const { absUploadPath } = require('../utils/files');
const { HttpError, ok, parseId } = require('../utils/http');

async function listMine(req, res) {
  ok(res, await signatureService.listUserSignatures(req.user.id));
}

async function saveMine(req, res) {
  const saved = await signatureService.saveUserSignature(req.user.id, req.body?.imageBase64);
  ok(res, saved, 201);
}

async function updateMine(req, res) {
  const id = parseId(req.params.id);
  const saved = await signatureService.updateUserSignature(req.user.id, id, req.body?.imageBase64);
  ok(res, saved);
}

async function getMineImage(req, res) {
  const sig = await signatureService.findUserSignature(req.user.id, parseId(req.params.id));
  res.type('image/png');
  res.send(await fs.readFile(absUploadPath(sig.image_path)));
}

async function deleteMine(req, res) {
  const id = parseId(req.params.id);
  await signatureService.deleteUserSignature(req.user.id, id);
  ok(res, { id });
}

async function setPrimaryMine(req, res) {
  const id = parseId(req.params.id);
  ok(res, await signatureService.setPrimaryUserSignature(req.user.id, id));
}

async function submit(req, res) {
  const { mouId, boxId, imageBase64, userSignatureId } = req.body || {};
  if (userSignatureId === undefined && imageBase64 === undefined) {
    throw new HttpError(400, 'imageBase64 or userSignatureId is required');
  }
  const result = await signatureService.submitSignature({
    mouId: parseId(mouId, 'mouId'),
    boxId: parseId(boxId, 'boxId'),
    userId: req.user.id,
    imageBase64,
    userSignatureId: userSignatureId === undefined ? undefined : parseId(userSignatureId, 'userSignatureId'),
    ipAddress: req.ip,
  });
  socketService.broadcastSignature(result);
  const { pngBytes, ...data } = result;
  ok(res, data, 201);
}

async function reset(req, res) {
  const result = await signatureService.resetSignature({
    mouId: parseId(req.params.id),
    boxId: parseId(req.params.boxId, 'boxId'),
    adminId: req.user.id,
    reason: req.body?.reason,
    ipAddress: req.ip,
  });
  socketService.broadcastSignatureReset(result);
  ok(res, result);
}

async function getBoxImage(req, res) {
  const mouId = parseId(req.params.id);
  await mouController.findAccessibleMou(req, mouId);
  const filePath = await signatureService.getBoxSignatureImagePath(
    mouId,
    parseId(req.params.boxId, 'boxId')
  );
  res.type('image/png');
  res.sendFile(filePath);
}

module.exports = {
  listMine,
  saveMine,
  updateMine,
  getMineImage,
  deleteMine,
  setPrimaryMine,
  submit,
  reset,
  getBoxImage,
};
