import express from 'express';
import * as controller from '../controllers/orderController.js';

import protect from '../middleware/auth.js';
import authorizeRoles from '../middleware/rbac.js';
import { Roles } from '../constants/roles.js';

const router = express.Router();

// --- Order Routes ---
// Base URL for these routes is /api/v1/orders
router.route('/')
  .post(protect, controller.createOrder)
  .get(protect, controller.getOrders);

router.route('/:id')
  .get(protect, controller.getOrderById)
  .patch(protect, authorizeRoles(Roles.admin, Roles.operator, Roles.spvarea, ), controller.updateOrder) // Using PATCH for partial updates like status and isAccepted
  .delete(protect, authorizeRoles(Roles.admin), controller.deleteOrder); // Soft delete

export default router;