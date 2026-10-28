const { Router } = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const adminController = require('../controllers/adminController');

const router = Router();

router.use(authenticate, requireRole('admin'));

router.get('/stats', adminController.stats);
router.get('/awaiting-mous', adminController.awaitingMous);
router.get('/recent-signatures', adminController.recentSignatures);
router.get('/activity-logs', adminController.activityLogs);
router.post('/ldap-test', adminController.ldapTest);
router.get('/settings', adminController.getSettings);
router.put('/settings', adminController.updateSettings);

module.exports = router;
