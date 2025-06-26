import User from '../models/User.js'
import { Roles } from '../constants/roles.js'
import { ErrorCode } from '../constants/errorCode.js';

// @desc    Create a new user
// @route   POST api/v1/users
// @access  Private/Admin
export const createUser = async (req, res) => {
  try {
    const { userId, name, password, roles, isActive } = req.body;
    const errors = [];

    // Controller-side validation for required fields
    if (!name || name.trim() === '') {
      errors.push('Nama pengguna diperlukan.');
    }
    if (!password) {
      errors.push('Kata sandi diperlukan.');
    } else if (password.length < 4) {
      errors.push('Kata sandi harus minimal 6 karakter.');
    }
    if (roles !== undefined) {
      if (!Array.isArray(roles) || roles.length === 0) {
        errors.push('Peran pengguna harus berupa array non-kosong.');
      } else {
        const invalidRoles = roles.filter(role => !Object.values(Roles).includes(role));
        if (invalidRoles.length > 0) {
          errors.push(`Peran tidak valid: ${invalidRoles.join(', ')}`);
        }
      }
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      errors.push('isActive harus berupa boolean jika disediakan.');
    }

    // Check if custom userId is provided and if it's unique
    if (userId) {
      if (typeof userId !== 'string' || userId.trim() === '') {
        errors.push('ID Pengguna harus berupa string non-kosong jika disediakan.');
      } else {
        const existingUser = await User.findOne({ userId: userId.trim().toUpperCase() });
        if (existingUser) {
          errors.push(`ID Pengguna '${userId}' sudah terdaftar.`);
        }
      }
    }

    if (errors.length > 0) {
      console.log(errors);
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }

    // Prepare user data. userId will be auto-generated if not provided
    const userData = {
      name: name.trim(),
      password: password, // Password will be hashed by pre-save hook in model
    };
    if (userId) userData.userId = userId.trim().toUpperCase();
    if (roles) userData.roles = roles;
    if (isActive !== undefined) userData.isActive = isActive;

    const user = await User.create(userData);
    const userResponse = user.toObject();
    delete userResponse.password; // Ensure password is not sent in response

    res.status(201).json({
      message: 'Pengguna berhasil dibuat.',
      user: userResponse,
    });
  } catch (error) {
    if (error.code === 11000) { // Duplicate key error
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({ message: `Pengguna dengan ${field} '${value}' sudah ada.` });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    console.error('Kesalahan saat membuat pengguna:', error);
    res.status(500).json({ message: 'Kesalahan server saat membuat pengguna.', error: error.message });
  }
};

// @desc    Get all users
// @route   GET /api/v1/users
// @access  Private/Admin
export const getUsers = async (req, res) => {
  try {
    const filter = { isDeleted: false };
    const { isActive, name, userId, roles } = req.query;

    // Build filter based on query parameters
    if (isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }
    if (name) {
      filter.name = { $regex: name, $options: 'i' };
    }
    if (userId) {
      filter.userId = { $regex: userId, $options: 'i' };
    }
    if (roles) {
      const roleArray = roles.split(',').map(r => r.trim());
      const invalidRoles = roleArray.filter(role => !Object.values(Roles).includes(role));
      if (invalidRoles.length > 0) {
        return res.status(400).json({ message: `Peran tidak valid dalam filter: ${invalidRoles.join(', ')}` });
      }
      filter.roles = { $in: roleArray };
    }

    // --- Authorization Logic for fetching users ---
    // Admin can get all users
    // SPV Area can get users within their assigned outlets (franchisees/operators)
    // Operators can only get their own profile (handled by getUserProfile in authController)
    if (!req.user || !req.user.roles) {
      return res.status(403).json({ message: 'Akses ditolak: Informasi peran pengguna tidak tersedia.' });
    }

    if (!req.user.roles.includes(Roles.admin)) {
      if (req.user.roles.includes(Roles.spvarea)) {
        const spvOutlets = await Outlet.find({ spvAreas: req.user._id, isDeleted: false, isActive: true }).select('_id');
        const outletIds = spvOutlets.map(outlet => outlet._id);
        // This would require a field in User model linking to Outlet, e.g., 'assignedOutlet'
        // For now, without that link, SPVArea can't filter by 'their' users directly here unless roles are tied to outlets.
        // Let's assume SPV Area can only see users of roles they manage (e.g., operators)
        // Or, more simply, if not admin, only their own user is returned.
        filter._id = req.user._id; // Temporarily restrict to own user if not admin
      } else {
        filter._id = req.user._id; // Restrict to current user's profile
      }
    }

    const users = await User.find(filter).select('-password').sort({ createdAt: -1 }); // Exclude password
    res.status(200).json(users.map(user => user.toJSON()));
  } catch (error) {
    console.error('Kesalahan saat mengambil pengguna:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengambil pengguna.', error: error.message });
  }
};

// @desc    Get latest updated user
// @route   GET /api/v1/users/sync
// @access  Private/Admin
export const syncUsers = async (req, res) => {
  const { latest, idList } = req.body; // idList is expected to be an array of user IDs from the client

  try {
    // 1. Validate 'latest' date
    const latestUpdate = new Date(latest);
    if (isNaN(latestUpdate.getTime())) {
      return res.status(400).json({
        errorCode: ErrorCode.invalidInput,
        message: 'Invalid latest timestamp provided.'
      });
    }

    if (!Array.isArray(idList)) {
      return res.status(400).json({
        errorCode: ErrorCode.invalidInput,
        message: 'idList must be an array of user IDs.'
      });
    }

    const clientIdSet = new Set(idList.map(id => id.toString()));

    const usersToProcess = await User.find({
      $or: [
        { createdAt: { $gt: latestUpdate } },
        { updatedAt: { $gt: latestUpdate } },
        { deletedAt: { $gt: latestUpdate } }
      ]
    }).select('-password');


    const toAdd = [];
    const toUpdate = [];
    const toDelete = [];

    usersToProcess.forEach(user => {
      const userIdString = user._id.toString();

      if (user.isDeleted) {
        toDelete.push(user.toObject());
      } else if (clientIdSet.has(userIdString)) {
        toUpdate.push(user.toObject());
      } else {
        toAdd.push(user.toObject());
      }
    });

    res.status(200).json({
      toAdd,
      toUpdate,
      toDelete
    });

  } catch (error) {
    console.error(`Error in syncUsers: ${error.message}`);
    res.status(500).json({
      errorCode: ErrorCode.serverError || 500,
      message: 'Server error during user synchronization',
      error: error.message
    });
  }
};

// @desc    Get user by ID
// @route   GET /api/users/:id
// @access  Private
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Pengguna tidak valid.' });
    }

    // --- Authorization Logic ---
    // Admin can get any user
    // Regular users can only get their own profile
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: 'Tidak terautentikasi.' });
    }
    if (!req.user.roles.includes(Roles.admin) && req.user._id.toString() !== id) {
      return res.status(403).json({ message: 'Akses ditolak: Anda hanya dapat melihat profil Anda sendiri.' });
    }

    const user = await User.findById(id).select('-password'); // Exclude password

    if (!user || user.isDeleted === true) {
      return res.status(404).json({ message: 'Pengguna tidak ditemukan atau sudah dihapus.' });
    }
    res.status(200).json(user.toJSON());
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Format ID Pengguna tidak valid.' });
    }
    console.error('Kesalahan saat mengambil pengguna berdasarkan ID:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengambil pengguna berdasarkan ID.', error: error.message });
  }
};

// @desc    Update a user by ID
// @route   PUT /api/v1/users/:id
// @access  Private/Admin
export const updateUserById = async (req, res) => {
  try {
    const { userId, name, roles, phone, password, isActive } = req.body;
    const existingUser = await User.findOne({ userId });

    if (existingUser && existingUser._id != req.params.id) {
      return res.status(404).json({ message: 'ID Pengguna sudah terdaftar' });
    }

    // Find the user by ID and update it
    const updatedUser = await User.findOneAndUpdate(
      { _id: req.params.id },
      { userId, name, roles, phone, password, isActive },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      message: 'Data Pengguna berhasil diubah',
      user: updatedUser
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Soft delete a user
// @route   DELETE /api/v1/users/:id
// @access  Private/Admin
export const softDeleteUserById = async (req, res) => {
  try {
    // Find the user by ID and soft delete it
    if (req.user._id == req.params.id) {
      return res.status(404).json({ message: 'Tidak dapat menghapus akun sendiri' });
    }

    const deletedUser = await User.findOneAndUpdate(
      { _id: req.params.id },
      { isActive: false, isDeleted: true, deletedAt: Date.now(), deletedBy: req.user._id },
      { new: true }
    );

    if (!deletedUser) {
      return res.status(404).json({ message: 'Pengguna tidak ditemukan' });
    }

    res.status(200).json({
      message: 'Data Pengguna berhasil dihapus',
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
