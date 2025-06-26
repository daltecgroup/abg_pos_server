import express from 'express';
import * as controller from '../controllers/outletInventoryTransactionController.js';
import multer from 'multer';
import path from 'path';
import sharp from 'sharp';
import fs from 'fs/promises';
import protect from '../middleware/auth.js';
import authorizeRoles from '../middleware/rbac.js';
import { Roles } from '../constants/roles.js';

const router = express.Router();

// --- Multer Configuration for Evidence Uploads ---
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Max 10MB for original file
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|pdf/; // Allow images and PDFs
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Hanya file gambar (JPEG, JPG, PNG, GIF) atau PDF yang diizinkan untuk bukti transaksi inventori.'));
  }
});

// Middleware to process and save evidence file
const processAndSaveInventoryEvidence = async (req, res, next) => {
  if (!req.file) {
    return next(); // No file uploaded, proceed. Controller will validate if evidence is required.
  }

  const evidenceDir = path.join('uploads', 'inventory_evidence');
  try {
    await fs.mkdir(evidenceDir, { recursive: true });
  } catch (dirError) {
    console.error('Gagal membuat direktori bukti inventori:', dirError);
    return res.status(500).json({ message: 'Kesalahan server saat menyiapkan penyimpanan bukti inventori.' });
  }

  const outputFileName = `${req.file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1E9)}`;
  const fileExtension = path.extname(req.file.originalname).toLowerCase();
  let finalBuffer = req.file.buffer; // Default to original buffer

  if (fileExtension === '.pdf') {
      // For PDFs, just save the buffer as is
      await fs.writeFile(path.join(evidenceDir, `${outputFileName}.pdf`), finalBuffer);
      req.file.filename = `${outputFileName}.pdf`;
  } else {
      // For images, resize and optimize (aim for max 1MB for inventory evidence, adjust as needed)
      try {
          const resizedBuffer = await sharp(req.file.buffer)
            .resize({ width: 1600, withoutEnlargement: true }) // Adjust width for detailed evidence
            .webp({ quality: 80 }) // Start with 80% quality for WebP
            .toBuffer();

          let quality = 80;
          while (resizedBuffer.length > 1024 * 1024 && quality > 10) { // Max 1MB
            quality -= 5;
            finalBuffer = await sharp(req.file.buffer) // Re-process from original buffer
              .resize({ width: 1600, withoutEnlargement: true })
              .webp({ quality: quality })
              .toBuffer();
          }

          if (finalBuffer.length > 1024 * 1024) {
              console.warn(`Ukuran gambar bukti inventori masih melebihi 1MB setelah kompresi maksimal. Ukuran: ${finalBuffer.length / 1024}KB`);
          }

          await fs.writeFile(path.join(evidenceDir, `${outputFileName}.webp`), finalBuffer);
          req.file.filename = `${outputFileName}.webp`;

      } catch (sharpError) {
          console.error('Kesalahan Sharp saat memproses gambar bukti inventori:', sharpError);
          // Fallback to original file if sharp fails
          await fs.writeFile(path.join(evidenceDir, `${outputFileName}${fileExtension}`), req.file.buffer);
          req.file.filename = `${outputFileName}${fileExtension}`;
          console.warn('Gagal memproses gambar bukti inventori dengan Sharp, menyimpan file asli.');
      }
  }

  req.file.path = path.join(evidenceDir, req.file.filename);
  req.file.size = finalBuffer.length;
  next();
};


// --- Outlet Inventory Transaction Routes ---
// Base URL for these routes will be /api/v1/outletinventorytransactions
router.route('/')
  .post(protect, upload.single('evidence'), processAndSaveInventoryEvidence, controller.createOutletInventoryTransaction)
  .get(protect, controller.getOutletInventoryTransactions);

router.route('/:id')
  .get(protect, controller.getOutletInventoryTransactionById)
  .patch(protect, authorizeRoles(Roles.admin), controller.updateOutletInventoryTransaction) // For isValid, isCalculated, notes update
  .delete(protect, authorizeRoles(Roles.admin), controller.deleteOutletInventoryTransaction); // Admin only soft delete

export default router;
