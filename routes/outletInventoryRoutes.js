import express from 'express';
import * as controller from '../controllers/outletInventoryController.js'; // The new controller
import protect from '../middleware/auth.js'; // Authentication middleware
import authorizeRoles from '../middleware/rbac.js'; // RBAC middleware
import { Roles } from '../constants/roles.js';

const router = express.Router();

// --- Outlet Inventory Routes ---
// Base URL: /api/v1/outletinventory

router.route('/')
  // Get all outlet inventories (typically for Admin/SPV Area to see all outlets' stock)
  .get(protect, authorizeRoles(Roles.admin, Roles.spvarea, Roles.franchisee), controller.getOutletInventories);

router.route('/:id')
  // Get a single outlet inventory by outlet ID
  // (ID here refers to the Outlet's _id, which is also the OutletInventory's _id)
  .get(protect, controller.getOutletInventoryById)
  // Update an outlet inventory (e.g., reorder levels, specific ingredient adjustments - NOT quantity changes)
  // Quantity changes should primarily come from OutletInventoryTransactions
  .patch(protect, authorizeRoles(Roles.admin, Roles.spvarea), controller.updateOutletInventory)
  // Soft delete an outlet inventory (only if the associated outlet is deleted)
  .delete(protect, authorizeRoles(Roles.admin), controller.deleteOutletInventory);

// Route for getting inventory for a specific outlet (useful for operators/franchisees)
router.get('/byoutlet/:outletId', protect, controller.getOutletInventoryByOutletId);

export default router;
