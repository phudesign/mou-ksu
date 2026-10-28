const { Router } = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const userController = require('../controllers/userController');
const { HttpError } = require('../utils/http');

const router = Router();

router.use(authenticate);

router.get('/me', userController.me);
// Profile fields (fname/lname/role) are edited by admins via PUT /:id only.
router.put('/me', (req, res, next) => next(new HttpError(403, 'Only admins can edit user profiles')));
router.get('/', requireRole('admin'), userController.list);
router.post('/', requireRole('admin'), userController.create);
router.put('/:id', requireRole('admin'), userController.update);

module.exports = router;
