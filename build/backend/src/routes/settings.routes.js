const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const settingsController = require('../controllers/settingsController');

const router = Router();

router.use(authenticate);

router.get('/signing-mode', settingsController.getSigningMode);

module.exports = router;