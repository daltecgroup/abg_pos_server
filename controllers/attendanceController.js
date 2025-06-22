import Attendance from '../models/Attendance.js'; // Import the Attendance model
import Outlet from '../models/Outlet.js';     // For outlet validation
import User from '../models/User.js';         // For operator validation
import { Roles } from '../constants/roles.js'; // For operator role validation
import mongoose from 'mongoose';              // For ObjectId validation

// Helper function to validate user as an Operator
const validateOperator = async (operatorId, errorsArray) => {
  if (!operatorId || !mongoose.Types.ObjectId.isValid(operatorId)) {
    errorsArray.push('ID Operator tidak valid.');
    return null;
  }
  const operatorUser = await User.findById(operatorId);
  if (!operatorUser || operatorUser.isDeleted || !operatorUser.isActive) {
    errorsArray.push(`Pengguna dengan ID Operator '${operatorId}' tidak ditemukan, sudah dihapus, atau tidak aktif.`);
    return null;
  }
  if (!operatorUser.roles.includes(Roles.operator)) {
    errorsArray.push(`Pengguna '${operatorUser.name}' (ID: '${operatorId}') bukan Operator.`);
    return null;
  }
  return { userId: operatorUser._id, userName: operatorUser.name };
};

// Helper to get start of day for consistent date comparison
const getStartOfDay = (date) => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0); // Use UTC to avoid timezone issues with date comparisons
  return d;
};

// @desc    Operator clocks in for the day
// @route   POST /api/v1/attendance/clockin
// @access  Private (Operator role)
export const clockIn = async (req, res) => {
  try {
    const { outletId } = req.body; // timeInEvidence now comes from req.file
    const errors = [];

    // Assuming req.user is populated by an authentication middleware
    const operatorId = req.user?._id;
    const createdByUserName = req.user?.name || 'Pengguna Tidak Dikenal';

    const operatorDetails = await validateOperator(operatorId, errors);
    if (!operatorDetails) {
        return res.status(400).json({ message: 'Validasi gagal.', errors });
    }

    // Validate Outlet
    if (!outletId || !mongoose.Types.ObjectId.isValid(outletId)) {
      errors.push('ID Outlet tidak valid.');
    } else {
      const outlet = await Outlet.findById(outletId);
      if (!outlet || outlet.isDeleted || !outlet.isActive) {
        errors.push('Outlet yang disediakan tidak ditemukan, sudah dihapus, atau tidak aktif.');
      }
    }

    // Validate TimeIn Evidence (now from req.file)
    if (!req.file) { // Check if a file was uploaded by multer
      errors.push('Bukti clock-in (gambar) diperlukan.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }

    const today = getStartOfDay(new Date());

    // Check if an attendance record already exists for this operator today
    const existingAttendance = await Attendance.findOne({
      operator: operatorId,
      date: today,
      isDeleted: false // Only check for active, non-deleted records
    });

    if (existingAttendance) {
      // If a file was uploaded but attendance already exists, delete the uploaded file
      if (req.file) {
        const fs = await import('fs/promises'); // Dynamically import fs
        try {
          await fs.unlink(req.file.path);
          console.log(`Deleted redundant uploaded file: ${req.file.path}`);
        } catch (fileErr) {
          console.error(`Error deleting redundant file ${req.file.path}:`, fileErr);
        }
      }
      return res.status(409).json({ message: 'Anda sudah clock-in hari ini.' });
    }

    const attendanceData = {
      outlet: outletId,
      operator: operatorId,
      date: today, // Ensure date is at start of day for uniqueness
      timeIn: new Date(), // Current time for clock-in
      timeInEvidence: `/uploads/attendance/evidence/${req.file.filename}`, // MODIFIED: Use new URL path for evidence
      createdBy: {
        userId: operatorDetails.userId,
        userName: operatorDetails.userName,
      },
    };

    const attendance = await Attendance.create(attendanceData);
    res.status(201).json({
      message: 'Clock-in berhasil.',
      attendance: attendance.toJSON()
    });

  } catch (error) {
    if (error.code === 11000) { // Duplicate key error (should be caught by existingAttendance check, but good fallback)
      return res.status(409).json({ message: 'Anda sudah clock-in hari ini (kesalahan duplikasi).'});
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    // Handle Multer-specific errors
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'Ukuran file terlalu besar. Maksimal 5MB.' });
      }
      return res.status(400).json({ message: `Kesalahan upload file: ${error.message}` });
    }
    // Handle other file type errors from fileFilter
    if (error.message.includes('Hanya file gambar')) {
      return res.status(400).json({ message: error.message });
    }

    console.error('Kesalahan saat clock-in:', error);
    res.status(500).json({ message: 'Kesalahan server saat clock-in.', error: error.message });
  }
};

// @desc    Operator clocks out for the day
// @route   PATCH /api/v1/attendance/clockout/:id
// @access  Private (Operator role)
export const clockOut = async (req, res) => {
  try {
    const { id } = req.params; // Attendance record ID
    // timeOutEvidence now comes from req.file
    const errors = [];

    // Assuming req.user is populated by an authentication middleware
    const operatorId = req.user?._id;
    const createdByUserName = req.user?.name || 'Pengguna Tidak Dikenal';

    // Validate Attendance ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      errors.push('ID Absensi tidak valid.');
    }

    // Validate TimeOut Evidence (now from req.file)
    if (!req.file) { // Check if a file was uploaded by multer
      errors.push('Bukti clock-out (gambar) diperlukan.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }

    const attendance = await Attendance.findById(id);

    if (!attendance || attendance.isDeleted) {
      // If a file was uploaded but attendance not found, delete the uploaded file
      if (req.file) {
        const fs = await import('fs/promises');
        try {
          await fs.unlink(req.file.path);
          console.log(`Deleted redundant uploaded file: ${req.file.path}`);
        } catch (fileErr) {
          console.error(`Error deleting redundant file ${req.file.path}:`, fileErr);
        }
      }
      return res.status(404).json({ message: 'Catatan absensi tidak ditemukan atau sudah dihapus.' });
    }

    // Ensure this operator is the one who created the record (or an admin)
    if (attendance.operator.toString() !== operatorId.toString()) {
      // If a file was uploaded but not authorized, delete the uploaded file
      if (req.file) {
        const fs = await import('fs/promises');
        try {
          await fs.unlink(req.file.path);
          console.log(`Deleted redundant uploaded file: ${req.file.path}`);
        } catch (fileErr) {
          console.error(`Error deleting redundant file ${req.file.path}:`, fileErr);
        }
      }
      return res.status(403).json({ message: 'Anda tidak diizinkan untuk clock-out pada catatan absensi ini.' });
    }

    if (attendance.timeOut) {
      // If a file was uploaded but already clocked out, delete the uploaded file
      if (req.file) {
        const fs = await import('fs/promises');
        try {
          await fs.unlink(req.file.path);
          console.log(`Deleted redundant uploaded file: ${req.file.path}`);
        } catch (fileErr) {
          console.error(`Error deleting redundant file ${req.file.path}:`, fileErr);
        }
      }
      return res.status(409).json({ message: 'Anda sudah clock-out untuk catatan absensi ini.' });
    }

    // Validate timeOut is after timeIn
    const currentTime = new Date();
    if (currentTime <= attendance.timeIn) {
      // If a file was uploaded but time invalid, delete the uploaded file
      if (req.file) {
        const fs = await import('fs/promises');
        try {
          await fs.unlink(req.file.path);
          console.log(`Deleted redundant uploaded file: ${req.file.path}`);
        } catch (fileErr) {
          console.error(`Error deleting redundant file ${req.file.path}:`, fileErr);
        }
      }
      return res.status(400).json({ message: 'Waktu clock-out harus setelah waktu clock-in.' });
    }

    attendance.timeOut = currentTime;
    attendance.timeOutEvidence = `/uploads/attendance/evidence/${req.file.filename}`, // MODIFIED: Use new URL path for evidence
    // Update createdBy if needed, or leave as original creator
    attendance.createdBy = { userId: operatorId, userName: createdByUserName }; // Set to current user making the update

    await attendance.save(); // Save the modified document

    res.status(200).json({
      message: 'Clock-out berhasil.',
      attendance: attendance.toJSON()
    });

  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Format ID Absensi tidak valid.' });
    }
    // Handle Multer-specific errors
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'Ukuran file terlalu besar. Maksimal 5MB.' });
      }
      return res.status(400).json({ message: `Kesalahan upload file: ${error.message}` });
    }
    // Handle other file type errors from fileFilter
    if (error.message.includes('Hanya file gambar')) {
      return res.status(400).json({ message: error.message });
    }

    console.error('Kesalahan saat clock-out:', error);
    res.status(500).json({ message: 'Kesalahan server saat clock-out.', error: error.message });
  }
};

// @desc    Get all attendance records (Admin/SPV Area access)
// @route   GET /api/v1/attendance
// @access  Private (Admin/SPV Area)
export const getAttendanceRecords = async (req, res) => {
  try {
    const filter = { isDeleted: false };
    const { operatorId, outletId, dateFrom, dateTo, isActive } = req.query;

    if (operatorId) {
      if (!mongoose.Types.ObjectId.isValid(operatorId)) {
        return res.status(400).json({ message: 'ID Operator tidak valid untuk filter.' });
      }
      filter.operator = operatorId;
    }
    if (outletId) {
      if (!mongoose.Types.ObjectId.isValid(outletId)) {
        return res.status(400).json({ message: 'ID Outlet tidak valid untuk filter.' });
      }
      filter.outlet = outletId;
    }
    if (dateFrom || dateTo) {
      filter.date = {};
      if (dateFrom) {
        const d = getStartOfDay(new Date(dateFrom));
        if (isNaN(d.getTime())) {
          return res.status(400).json({ message: 'Format tanggal "dateFrom" tidak valid.' });
        }
        filter.date.$gte = d;
      }
      if (dateTo) {
        const d = getStartOfDay(new Date(dateTo));
        if (isNaN(d.getTime())) {
          return res.status(400).json({ message: 'Format tanggal "dateTo" tidak valid.' });
        }
        // Add one day to dateTo to include the entire end day
        filter.date.$lte = new Date(d.getTime() + 24 * 60 * 60 * 1000 - 1); // Up to the last millisecond of dateTo
      }
    }
    if (isActive !== undefined) {
      filter.isActive = isActive === 'true'; // If you add isActive to AttendanceSchema
    }


    const attendanceRecords = await Attendance.find(filter)
                                            .populate('outlet', 'name code address')
                                            .populate('operator', 'name userId roles')
                                            .populate('createdBy.userId', 'name userId')
                                            .sort({ date: -1, timeIn: -1 }); // Sort by newest date, then newest timeIn

    res.status(200).json(attendanceRecords.map(record => record.toJSON()));

  } catch (error) {
    console.error('Kesalahan saat mengambil catatan absensi:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengambil catatan absensi.', error: error.message });
  }
};


// @desc    Get a single attendance record by ID
// @route   GET /api/v1/attendance/:id
// @access  Private (Admin/Operator/SPV Area - operator can only view their own)
export const getAttendanceRecordById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Absensi tidak valid.' });
    }

    const attendance = await Attendance.findById(id)
                                    .populate('outlet', 'name code address')
                                    .populate('operator', 'name userId roles')
                                    .populate('createdBy.userId', 'name userId');

    if (!attendance || attendance.isDeleted === true) {
      return res.status(404).json({ message: 'Catatan absensi tidak ditemukan atau sudah dihapus.' });
    }

    // Security check: If not admin/SPV Area, ensure operator can only view their own record
    // This assumes your authentication middleware sets req.user.roles
    // if (!req.user.roles.includes(Roles.ADMIN) && !req.user.roles.includes(Roles.SPV_AREA)) {
    //   if (attendance.operator.toString() !== req.user._id.toString()) {
    //     return res.status(403).json({ message: 'Anda tidak diizinkan untuk melihat catatan absensi ini.' });
    //   }
    // }

    res.status(200).json(attendance.toJSON());
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Format ID Absensi tidak valid.' });
    }
    console.error('Kesalahan saat mengambil catatan absensi berdasarkan ID:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengambil catatan absensi.', error: error.message });
  }
};

// @desc    Soft delete an attendance record by ID (Admin only)
// @route   DELETE /api/v1/attendance/:id
// @access  Private (Admin role)
export const deleteAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Absensi tidak valid.' });
    }

    // Optional: Check if user has ADMIN role before proceeding
    // if (!req.user || !req.user.roles.includes(Roles.ADMIN)) {
    //   return res.status(403).json({ message: 'Anda tidak memiliki izin untuk menghapus catatan absensi.' });
    // }

    const attendance = await Attendance.findByIdAndUpdate(
      id,
      { isDeleted: true, deletedAt: new Date() /* , deletedBy: req.user.id */ },
      { new: true }
    );

    if (!attendance) {
      return res.status(404).json({ message: 'Catatan absensi tidak ditemukan.' });
    }

    res.status(200).json({
      message: 'Catatan absensi berhasil dihapus (soft delete).',
      attendance: attendance.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Format ID Absensi tidak valid.' });
    }
    console.error('Kesalahan saat menghapus catatan absensi:', error);
    res.status(500).json({ message: 'Kesalahan server saat menghapus catatan absensi.', error: error.message });
  }
};
