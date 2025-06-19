import { Router } from 'express';
import { registerAdmin, authUser, getUserProfile } from '../controllers/authController.js';
import protect from '../middleware/auth.js'; // Authentication middleware

const router = Router();

// Public routes for authentication
router.post('/register-admin', registerAdmin);
router.post('/login', authUser);
router.get('/profile', protect, getUserProfile);

export default router;