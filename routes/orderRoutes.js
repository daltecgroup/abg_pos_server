import express from 'express';
import * as controller from '../controllers/orderController.js';

const router = express.Router();

// --- Order Routes ---
// Base URL for these routes is /api/v1/orders
router.route('/')
  .post(controller.createOrder)
  .get(controller.getOrders);

router.route('/:id')
  .get(controller.getOrderById)
  .patch(controller.updateOrder) // Using PATCH for partial updates like status and isAccepted
  .delete(controller.deleteOrder); // Soft delete

export default router;