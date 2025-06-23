import express from 'express';
import {
    clockIn,
    clockOut,
    deleteAttendance,
    getAttendanceRecordById,
    getAttendanceRecords
} from '../controllers/attendanceController.js';
import protect from '../middleware/auth.js';
import multer from 'multer';
import path from 'path';
import sharp from 'sharp';
import fs from 'fs/promises';

const router = express.Router();

const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Hanya file gambar (JPEG, JPG, PNG, GIF) yang diizinkan!'));
    }
});

const resizeAndSaveImage = async (req, res, next) => {
    if (!req.file) {
        return next();
    }

    const evidenceDir = path.join('uploads', 'attendance', 'evidence');
    try {
        await fs.mkdir(evidenceDir, { recursive: true });
    } catch (dirError) {
        console.error('Gagal membuat direktori bukti absensi:', dirError);
        return res.status(500).json({ message: 'Kesalahan server saat menyiapkan penyimpanan gambar.' });
    }

    const outputFileName = `${req.file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1E9)}.webp`;
    const outputPath = path.join(evidenceDir, outputFileName);

    try {
        const resizedBuffer = await sharp(req.file.buffer)
            .resize({ width: 800, withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer();

        let finalBuffer = resizedBuffer;
        let quality = 80;
        while (finalBuffer.length > 200 * 1024 && quality > 10) {
            quality -= 5;
            finalBuffer = await sharp(req.file.buffer)
                .resize({ width: 800, withoutEnlargement: true })
                .webp({ quality: quality })
                .toBuffer();
        }

        if (finalBuffer.length > 200 * 1024) {
            console.warn(`Ukuran gambar masih melebihi 200KB setelah kompresi maksimal. Ukuran: ${finalBuffer.length / 1024}KB`);
        }

        // Save the processed image to disk
        await fs.writeFile(outputPath, finalBuffer);

        req.file.filename = outputFileName;
        req.file.path = outputPath;
        req.file.size = finalBuffer.length;

        next();
    } catch (error) {
        console.error('Kesalahan saat memproses gambar:', error);
        return res.status(500).json({ message: 'Kesalahan server saat memproses gambar.' });
    }
};

router.get('/', protect, getAttendanceRecords);
router.post('/clockin', protect, upload.single('evidenceImage'), resizeAndSaveImage, clockIn);
router.patch('/clockout/:id', protect, upload.single('evidenceImage'), resizeAndSaveImage, clockOut);
router.route('/:id')
    .get(protect, getAttendanceRecordById)
    .delete(protect, deleteAttendance)

export default router;
