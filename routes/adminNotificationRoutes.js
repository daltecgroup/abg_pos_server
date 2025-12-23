import express from 'express';
import * as controller from '../controllers/adminNotificationController.js';
// Asumsi Anda punya middleware auth
import protect from '../middleware/auth.js';

const router = express.Router();

router.get('/',protect, controller.index);
router.post('/', protect, controller.store); // Opsional (untuk test)
router.patch('/:id/open', protect, controller.markAsOpened);
router.delete('/:id', protect, controller.destroy);

export default router;