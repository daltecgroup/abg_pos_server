import express from 'express';
import * as userOutletController from '../controllers/userOutletController.js';
import protect from '../middleware/auth.js'; // Assuming you have a protect middleware

const router = express.Router();

/**
 * @fileoverview Defines API routes for the UserOutlet model.
 * Base path: /api/useroutlets
 */

// Route to get or set the user's current outlet
router.route('/')
  // Get the current outlet for the authenticated user
  .get(protect, userOutletController.getCurrentOutlet)
  // Set the current outlet for the authenticated user
  .post(protect, userOutletController.setCurrentOutlet);

export default router;
