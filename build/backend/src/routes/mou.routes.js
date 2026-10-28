const { Router } = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { uploadPdf, requirePdfMagicBytes } = require('../middleware/upload');
const mouController = require('../controllers/mouController');
const signatureController = require('../controllers/signatureController');

const router = Router();

router.use(authenticate);

router.get('/', mouController.list);
router.post('/upload', requireRole('admin'), uploadPdf, requirePdfMagicBytes, mouController.upload);
router.get('/:id', mouController.getById);
router.get('/:id/pdf', mouController.getPdf);
router.get('/:id/signed-pdf', mouController.getSignedPdf);
router.get('/:id/audit', mouController.audit);
router.get('/:id/boxes/:boxId/signature', signatureController.getBoxImage);
router.post('/:id/boxes/:boxId/reset', requireRole('admin'), signatureController.reset);
router.put('/:id', requireRole('admin'), mouController.update);
router.delete('/:id', requireRole('admin'), mouController.remove);

module.exports = router;
