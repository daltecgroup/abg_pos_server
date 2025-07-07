import express from 'express';
import * as controller from '../controllers/promoSettingController.js';
import protect from '../middleware/auth.js'; // Uncomment if you have authentication middleware
import authorizeRoles from '../middleware/rbac.js';
import { Roles } from '../constants/roles.js';
const router = express.Router();

// --- Promo Setting Routes ---
// Base URL for these routes will be /api/v1/promosettings

// Get all promo settings (read-only)
router.route('/')
  .get(controller.getPromoSettings);

// Get a single promo setting by code (read-only)
// Update a promo setting by code (requires authentication and admin role)
router.route('/:code')
  .get(controller.getPromoSettingByCode)
  // Apply protect and authorizeRoles middleware if you have them
  .patch(protect, authorizeRoles(Roles.admin), controller.updatePromoSetting);


export default router;
