// routes/dataInitRoutes.js

import express from 'express';
import {
    clearAllIngredients,
    uploadAndInitiateIngredientDataFromXlsx
} from '../controllers/dataInitController.js';
import protect from '../middleware/auth.js';
import authorizeRoles from '../middleware/rbac.js';
import { Roles } from '../constants/roles.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';

const router = express.Router();

// --- Multer Configuration for File Uploads (XLSX) ---
const uploadDir = path.join('uploads', 'temp_data_imports');

// Set up disk storage for multer
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    // Ensure the upload directory exists
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      console.error('Error creating upload directory:', error);
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    // Generate a unique filename for the uploaded file
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Configure Multer to accept a single file with specific field names
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Max 5MB for the file
  fileFilter: (req, file, cb) => {
    const filetypes = /xlsx|vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/; // Only XLSX MIME types
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Hanya file XLSX yang diizinkan!')); // Updated error message
  }
});


// --- Data Initialization Routes ---
// Base URL for these routes will be /api/v1/data-init

// Route to upload an XLSX file and then initiate ingredient data from it
router.post('/upload-ingredients-xlsx', protect, authorizeRoles(Roles.admin), upload.single('ingredientsXlsxFile'), uploadAndInitiateIngredientDataFromXlsx);

// Route to clear all ingredients
router.delete('/ingredients/all', protect, authorizeRoles(Roles.admin), clearAllIngredients);

export default router;
