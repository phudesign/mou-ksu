const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const signatureController = require('../controllers/signatureController');

const router = Router();

router.use(authenticate);

router.get('/my', signatureController.listMine);
router.get('/my/:id/image', signatureController.getMineImage);
router.put('/my/:id/primary', signatureController.setPrimaryMine);
router.put('/my/:id', signatureController.updateMine);
router.delete('/my/:id', signatureController.deleteMine);
router.post('/save', signatureController.saveMine);
router.post('/submit', signatureController.submit);

module.exports = router;
