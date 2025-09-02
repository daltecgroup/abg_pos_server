import express from 'express';
import * as controller from '../controllers/userController.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import protect from '../middleware/auth.js'; // Authentication middleware
import authorizeRoles from '../middleware/rbac.js';
import { Roles } from '../constants/roles.js';

const router = express.Router();
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Max 2MB for original file
  fileFilter: (req, file, cb) => {
    // List of allowed MIME types
    const allowedMimeTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
    ];

    // Check if the file's MIME type is in the allowed list
    const isMimeTypeAllowed = allowedMimeTypes.includes(file.mimetype);

    // Also check the file extension as a second line of defense
    const filetypesRegex = /jpeg|jpg|png|gif/;
    const extname = filetypesRegex.test(path.extname(file.originalname).toLowerCase());

    console.log(`File MIME type: ${file.mimetype}`);
    console.log(`Is MIME type allowed? ${isMimeTypeAllowed}`);
    console.log(`Is extension valid? ${extname}`);

    if (isMimeTypeAllowed && extname) {
      return cb(null, true);
    }

    cb(new Error('Hanya file gambar (JPEG, JPG, PNG, GIF) yang diizinkan untuk foto profil.'));
  }
});

const processAndSaveUserProfile = async (req, res, next) => {
  
  if (!req.file) {
    return res.status(400).json({ message: 'File gambar tidak ditemukan' });
  }

  const profileImageUrl = path.join('uploads', 'user');
  try {
    await fs.mkdir(profileImageUrl, { recursive: true });
  } catch (dirError) {
    console.error('Gagal membuat direktori gambar profil:', dirError);
    return res.status(500).json({ message: 'Kesalahan server saat menyiapkan penyimpanan gambar profil' });
  }

  const outputFileName = `${req.file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1E9)}`;
  const fileExtension = path.extname(req.file.originalname).toLowerCase();
  let finalBuffer = req.file.buffer; // Default to original buffer

  try {
    await fs.writeFile(path.join(profileImageUrl, `${outputFileName}.webp`), finalBuffer);
    req.file.filename = `${outputFileName}.webp`;
  } catch (error) {
    console.error('Kesalahan saat memproses gambar profil:', error);
    // If image processing fails, you might want to save the original or return an error
    await fs.writeFile(path.join(profileImageUrl, `${outputFileName}${fileExtension}`), req.file.buffer); // Fallback to original
    req.file.filename = `${outputFileName}${fileExtension}`;
    console.warn('Gagal memproses gambar, menyimpan file asli.');
  }

  req.file.path = path.join(profileImageUrl, req.file.filename);
  req.file.size = finalBuffer.length;
  next();
};

router.route('/')
  .get(protect, controller.getUsers)
  .post(protect, authorizeRoles(Roles.admin), controller.createUser);

router.route('/sync')
  .post(protect, controller.syncUsers);

router.route('/:id')
  .get(protect, controller.getUserById)
  .put(protect, authorizeRoles(Roles.admin), controller.updateUserById)
  .delete(protect, authorizeRoles(Roles.admin), controller.softDeleteUserById);

router.route('/:id/profile')
  .put(protect, upload.single('profileImage'), processAndSaveUserProfile, controller.updateUserProfileById);

export default router;