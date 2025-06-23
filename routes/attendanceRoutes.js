import express from 'express';
import * as attendanceController from '../controllers/attendanceController.js';
import multer from 'multer'; // NEW: Import multer
import path from 'path';    // NEW: Import path for file extension
import sharp from 'sharp';  // NEW: Import sharp
import fs from 'fs/promises'; // NEW: Import fs/promises for directory creation

const router = express.Router();

// --- Multer Configuration for Image Uploads ---
// MODIFIED: Use memory storage for Multer
const storage = multer.memoryStorage();

// Configure Multer to accept single image file with field name 'evidenceImage'
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Allow a slightly larger initial upload (e.g., 10MB) before compression
  fileFilter: (req, file, cb) => {
    // Accept only image files
    const filetypes = /jpeg|jpg|png|gif/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Hanya file gambar (JPEG, JPG, PNG, GIF) yang diizinkan!'));
  }
});

// NEW: Middleware to resize and optimize image
const resizeAndSaveImage = async (req, res, next) => {
  if (!req.file) {
    return next(); // No file uploaded, proceed to next middleware
  }

  // Define the full target directory for evidence
  const evidenceDir = path.join('uploads', 'attendance', 'evidence');
  // Ensure the directory exists
  try {
    await fs.mkdir(evidenceDir, { recursive: true });
  } catch (dirError) {
    console.error('Gagal membuat direktori bukti absensi:', dirError);
    return res.status(500).json({ message: 'Kesalahan server saat menyiapkan penyimpanan gambar.' });
  }

  const outputFileName = `${req.file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1E9)}.webp`; // Use webp for better compression
  const outputPath = path.join(evidenceDir, outputFileName); // Path to save the processed image

  try {
    // Use sharp to process the image
    const resizedBuffer = await sharp(req.file.buffer)
      .resize({ width: 800, withoutEnlargement: true }) // Resize to a max width of 800px, don't enlarge
      .webp({ quality: 80 }) // Convert to WebP and set quality
      .toBuffer(); // Get the processed image as a buffer

    // Check size and adjust quality if needed (iterative compression)
    let finalBuffer = resizedBuffer;
    let quality = 80;
    while (finalBuffer.length > 200 * 1024 && quality > 10) { // Max 200KB, stop if quality too low
      quality -= 5; // Reduce quality by 5%
      finalBuffer = await sharp(req.file.buffer) // Re-process from original buffer for better quality degradation
        .resize({ width: 800, withoutEnlargement: true })
        .webp({ quality: quality })
        .toBuffer();
    }

    if (finalBuffer.length > 200 * 1024) {
        console.warn(`Ukuran gambar masih melebihi 200KB setelah kompresi maksimal. Ukuran: ${finalBuffer.length / 1024}KB`);
        // You might want to return an error here, or just accept the larger size
        // For this example, we'll proceed but log a warning.
    }

    // Save the processed image to disk
    await fs.writeFile(outputPath, finalBuffer);

    // Update req.file details for the next middleware (controller)
    req.file.filename = outputFileName;
    req.file.path = outputPath; // Full path on disk
    req.file.size = finalBuffer.length; // Update size

    next(); // Proceed to the controller
  } catch (error) {
    console.error('Kesalahan saat memproses gambar:', error);
    return res.status(500).json({ message: 'Kesalahan server saat memproses gambar.' });
  }
};


// --- Attendance Routes ---
router.route('/clockin')
  // Operator Clock-in
  // POST /api/attendance/clockin (Expects 'evidenceImage' as the field name for the file)
  .post(upload.single('evidenceImage'), resizeAndSaveImage, attendanceController.clockIn);

router.route('/clockout/:id')
  // Operator Clock-out (PATCH for partial update of an existing record)
  // PATCH /api/attendance/clockout/:id (Expects 'evidenceImage' as the field name for the file)
  .patch(upload.single('evidenceImage'), resizeAndSaveImage, attendanceController.clockOut);

router.route('/')
  // Get all attendance records (e.g., for Admin/SPV Area dashboard)
  // GET /api/attendance?operatorId=...&outletId=...&dateFrom=...&dateTo=...
  .get(attendanceController.getAttendanceRecords);

router.route('/:id')
  // Get a specific attendance record by ID
  // GET /api/attendance/:id
  .get(attendanceController.getAttendanceRecordById)
  // Soft delete an attendance record (typically Admin only)
  // DELETE /api/attendance/:id
  .delete(attendanceController.deleteAttendance);


export default router;
