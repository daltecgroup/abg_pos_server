// routes/outletInventoryTransactionRoutes.js

import express from 'express';
import * as outletInventoryTransactionController from '../controllers/outletInventoryTransactionController.js';
import protect from '../middleware/auth.js'; // Assuming you have an authentication middleware
// import authorizeRoles from '../middleware/rbac.js'; // Uncomment if you have RBAC middleware
// import { Roles } from '../constants/roles.js'; // Uncomment if using Roles for authorization
import multer from 'multer'; // Import multer for file uploads
import path from 'path'; // For path.extname

const router = express.Router();

// Multer setup for file uploads (e.g., for evidence)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Make sure this directory exists in your project root
    cb(null, 'uploads/inventory_evidence');
  },
  filename: (req, file, cb) => {
    // Example: originalname-timestamp.ext
    cb(null, `${file.originalname.split('.')[0]}-${Date.now()}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (req, file, cb) => {
  // Accept images only
  if (!file.mimetype.startsWith('image/') && !file.mimetype === 'application/pdf') {
    return cb(new Error('Hanya file gambar atau PDF yang diizinkan!'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 1024 * 1024 * 10 // 10 MB limit
  }
});


// --- Outlet Inventory Transaction Routes ---
// Base URL for these routes will be /api/v1/outletinventorytransactions

router.route('/')
  .post(protect, upload.single('evidenceFile'), outletInventoryTransactionController.createOutletInventoryTransaction)
  .get(protect, outletInventoryTransactionController.getOutletInventoryTransactions);

// NEW ROUTE FOR BULK CREATION
router.route('/bulk')
  .post(protect, upload.single('evidenceFile'), outletInventoryTransactionController.createMultipleOutletInventoryTransactions); // Use upload.none() if no files for bulk or adjust for array of files

router.route('/:id')
  .get(protect, outletInventoryTransactionController.getOutletInventoryTransactionById)
  .patch(protect, upload.single('evidenceFile'), outletInventoryTransactionController.updateOutletInventoryTransaction)
  // Ensure only Admins can soft-delete
  .delete(protect, /* authorizeRoles(Roles.ADMIN), */ outletInventoryTransactionController.deleteOutletInventoryTransaction);

export default router;
