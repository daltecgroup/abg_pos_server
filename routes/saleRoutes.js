import express from 'express';
import * as saleController from '../controllers/saleController.js';
import multer from 'multer'; // For handling file uploads (payment evidence)
import path from 'path';
import sharp from 'sharp';
import fs from 'fs/promises';
import protect from '../middleware/auth.js';

const router = express.Router();

// --- Multer Configuration for Payment Evidence Image Uploads ---
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Max 10MB for original file
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|pdf/; // Allow PDF for payment evidence
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Hanya file gambar (JPEG, JPG, PNG, GIF) atau PDF yang diizinkan untuk bukti pembayaran.'));
  }
});

// Middleware to resize/optimize image and save, or just save PDF
const processAndSavePaymentEvidence = async (req, res, next) => {
  if (!req.file) {
    // If no file, but it's a non-cash payment, the controller will handle the error
    return next();
  }

  const paymentEvidenceDir = path.join('uploads', 'payment', 'evidence');
  try {
    await fs.mkdir(paymentEvidenceDir, { recursive: true });
  } catch (dirError) {
    console.error('Gagal membuat direktori bukti pembayaran:', dirError);
    return res.status(500).json({ message: 'Kesalahan server saat menyiapkan penyimpanan bukti pembayaran.' });
  }

  const outputFileName = `${req.file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1E9)}`;
  const fileExtension = path.extname(req.file.originalname).toLowerCase();
  let finalBuffer = req.file.buffer; // Default to original buffer

  if (fileExtension === '.pdf') {
      // For PDFs, just save the buffer as is
      await fs.writeFile(path.join(paymentEvidenceDir, `${outputFileName}.pdf`), finalBuffer);
      req.file.filename = `${outputFileName}.pdf`;
  } else {
      // For images, resize and optimize
      try {
          const resizedBuffer = await sharp(req.file.buffer)
            .resize({ width: 1200, withoutEnlargement: true }) // Adjust width as suitable for evidence
            .webp({ quality: 80 }) // Start with 80% quality for WebP
            .toBuffer();

          let quality = 80;
          // Loop to reduce quality until size is < 500KB (or minimum quality reached)
          // Evidence images might be larger than attendance, so aim for 500KB
          while (resizedBuffer.length > 500 * 1024 && quality > 10) {
            quality -= 5;
            finalBuffer = await sharp(req.file.buffer) // Re-process from original buffer
              .resize({ width: 1200, withoutEnlargement: true })
              .webp({ quality: quality })
              .toBuffer();
          }

          if (finalBuffer.length > 500 * 1024) {
              console.warn(`Ukuran gambar bukti pembayaran masih melebihi 500KB setelah kompresi maksimal. Ukuran: ${finalBuffer.length / 1024}KB`);
          }

          await fs.writeFile(path.join(paymentEvidenceDir, `${outputFileName}.webp`), finalBuffer);
          req.file.filename = `${outputFileName}.webp`;

      } catch (sharpError) {
          console.error('Kesalahan Sharp saat memproses gambar bukti pembayaran:', sharpError);
          // If image processing fails, you might want to save the original or return an error
          await fs.writeFile(path.join(paymentEvidenceDir, `${outputFileName}${fileExtension}`), req.file.buffer); // Fallback to original
          req.file.filename = `${outputFileName}${fileExtension}`;
          console.warn('Gagal memproses gambar bukti pembayaran dengan Sharp, menyimpan file asli.');
      }
  }

  req.file.path = path.join(paymentEvidenceDir, req.file.filename);
  req.file.size = finalBuffer.length;
  next();
};


// --- Sale Routes ---
router.route('/')
  // Create a new sale
  // POST /api/sales (Expects 'paymentEvidence' as the field name for the file if payment method requires it)
  .post(protect, upload.single('paymentEvidence'), processAndSavePaymentEvidence, saleController.createSale)
  // Get all sales
  // GET /api/sales?outletId=...&operatorId=...&dateFrom=...&dateTo=...&isValid=...&paymentMethod=...
  .get(saleController.getSales);

router.route('/:id')
  // Get a single sale by ID
  // GET /api/sales/:id
  .get(saleController.getSaleById)
  // Update a sale (e.g., isValid, add invoicePrintHistory)
  // PATCH /api/sales/:id
  .patch(saleController.updateSale) // Use PATCH for partial updates
  // Soft delete a sale (Admin only)
  // DELETE /api/sales/:id
  .delete(saleController.deleteSale);

export default router;
