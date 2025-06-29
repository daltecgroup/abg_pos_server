import Outlet from '../models/Outlet.js'; // Import the Outlet model
import User from '../models/User.js';    // Import the User model for role validation
import { Roles } from '../constants/roles.js'; // Assuming this defines your roles like { FRANCHISEEE: 'Franchisee' }
import mongoose from 'mongoose'; // For ObjectId validation

// Helper function to validate user IDs and their roles
const validateUsersAndRoles = async (userIds, requiredRole, errorsArray, fieldName) => {
  if (!userIds || !Array.isArray(userIds)) {
    return; // No users provided for this field, or not an array. Let other validation handle if required.
  }

  for (let i = 0; i < userIds.length; i++) {
    const userId = userIds[i];
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      errorsArray.push(`Format ID Pengguna tidak valid untuk ${fieldName} pada indeks ${i}: '${userId}'.`);
      continue;
    }
    const user = await User.findById(userId);
    if (!user) {
      errorsArray.push(`ID Pengguna ${fieldName} '${userId}' pada indeks ${i} tidak ditemukan.`);
      continue;
    }
    if (!user.roles.includes(requiredRole)) {
      errorsArray.push(`Pengguna '${user.name}' (ID: '${userId}') untuk ${fieldName} pada indeks ${i} tidak memiliki peran '${requiredRole}'.`);
    }
  }
};


// @desc    Create a new outlet
// @route   POST /api/v1/outlets
// @access  Private/Admin
export const createOutlet = async (req, res) => {
  try {
    const { name, isActive, franchisees, operators, spvAreas, address, imgUrl, foundedAt } = req.body;

    // --- Controller-side Validation for Create ---
    const errors = [];

    if (!name || name.trim() === '') {
      errors.push('Nama wajib diisi.');
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      errors.push('isActive harus berupa boolean jika disediakan.');
    }

    // Validate address fields
    if (!address) {
      errors.push('Alamat wajib diisi.');
    } else {
      if (!address.province || address.province.trim() === '') errors.push('Provinsi alamat wajib diisi.');
      if (!address.regency || address.regency.trim() === '') errors.push('Kabupaten/Kota alamat wajib diisi.');
      if (!address.district || address.district.trim() === '') errors.push('Kecamatan alamat wajib diisi.');
      if (!address.village || address.village.trim() === '') errors.push('Desa/Kelurahan alamat wajib diisi.');
      if (!address.street || address.street.trim() === '') errors.push('Jalan alamat wajib diisi.');
    }

    if (imgUrl !== undefined && typeof imgUrl !== 'string') {
      errors.push('imgUrl harus berupa string.');
    } else if (imgUrl !== undefined) {
      req.body.imgUrl = imgUrl.trim(); // Trim imgUrl if provided
    }

    if (foundedAt !== undefined && isNaN(new Date(foundedAt).getTime())) {
      errors.push('Tanggal didirikan tidak valid.');
    }

    // Validate user lists and their roles
    await validateUsersAndRoles(franchisees, Roles.franchisee, errors, 'Penerima Waralaba');
    await validateUsersAndRoles(operators, Roles.operator, errors, 'Operator');
    await validateUsersAndRoles(spvAreas, Roles.spvarea, errors, 'SPV Area');

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal', errors });
    }
    // --- End Controller-side Validation ---

    // Trim name before creating
    req.body.name = req.body.name.trim();
    // Trim address fields if they exist
    if (req.body.address) {
      req.body.address.province = req.body.address.province?.trim();
      req.body.address.regency = req.body.address.regency?.trim();
      req.body.address.district = req.body.address.district?.trim();
      req.body.address.village = req.body.address.village?.trim();
      req.body.address.street = req.body.address.street?.trim();
    }


    const outlet = await Outlet.create(req.body); // Code will be set by pre-save hook
    res.status(201).json({
      message: 'Outlet berhasil dibuat',
      outlet: outlet.toJSON()
    });
  } catch (error) {
    if (error.code === 11000) { // Duplicate key error for 'name'
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({ message: `Outlet dengan ${field} '${value}' ini sudah ada.` });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal', errors });
    }
    console.error('Error creating outlet:', error);
    res.status(500).json({ message: 'Kesalahan server saat membuat outlet', error: error.message });
  }
};

// @desc    Get all outlets
// @route   GET /api/v1/outlets
// @access  Public
export const getOutlets = async (req, res) => {
  try {
    const filter = { isDeleted: false }; // Default: get non-deleted outlets
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }
    if (req.query.name) {
      filter.name = { $regex: req.query.name, $options: 'i' };
    }
    if (req.query.code) {
      filter.code = { $regex: req.query.code, $options: 'i' };
    }
    // You might add filtering by address parts, or by associated user IDs if needed

    const query = Outlet.find(filter).sort({ createdAt: -1 });

    // Populate associated users if requested or always
    const populateFields = req.query.populate;
    if (populateFields) {
      if (populateFields.includes('franchisees')) query.populate('franchisees', 'name userId');
      if (populateFields.includes('operators')) query.populate('operators', 'name userId');
      if (populateFields.includes('spvAreas')) query.populate('spvAreas', 'name userId');
    }
    // else {
    // Default populate commonly needed fields if no populate param
    //     query.populate('franchisees', 'name userId')
    //          .populate('operators', 'name userId')
    //          .populate('spvAreas', 'name userId');
    // }


    const outlets = await query.exec();
    res.status(200).json(outlets.map(outlet => outlet.toJSON()));
  } catch (error) {
    console.error('Error getting outlets:', error);
    res.status(500).json({ message: 'Kesalahan server saat mendapatkan outlet', error: error.message });
  }
};

// @desc    Get a single outlet by ID
// @route   GET /api/v1/outlets/:id
// @access  Public
export const getOutletById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Outlet tidak valid.' });
    }

    const outlet = await Outlet.findById(id)
      .populate('franchisees', 'name userId')
      .populate('operators', 'name userId')
      .populate('spvAreas', 'name userId');

    if (!outlet || outlet.isDeleted === true) {
      return res.status(404).json({ message: 'Outlet tidak ditemukan atau sudah dihapus' });
    }
    res.status(200).json(outlet.toJSON());
  } catch (error) {
    console.error('Error getting outlet by ID:', error);
    res.status(500).json({ message: 'Kesalahan server saat mendapatkan outlet', error: error.message });
  }
};

// @desc    Update an outlet by ID
// @route   PUT /api/v1/outlets/:id
// @access  Private/Admin
export const updateOutlet = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    console.log(updateData);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Outlet tidak valid.' });
    }

    // check if outlet with same code is exist and not deleted
    if (updateData.code !== undefined && typeof updateData.code === 'string') {
      const existingCode = await Outlet.find({
        _id: { $ne: id },
        code: updateData.code,
        isDeleted: false
      });
      if (existingCode.length > 0) {
        return res.status(409).json({ message: `Gerai dengan kode '${updateData.code}' sudah ada.` });
      }
    }

    // check if outlet with same name is exist and not deleted
    if (updateData.name !== undefined && typeof updateData.name === 'string') {
      const existingName = await Outlet.find({
        _id: { $ne: id },
        name: updateData.name,
        isDeleted: false
      });
      if (existingName.length > 0) {
        return res.status(409).json({ message: `Gerai dengan nama '${updateData.name}' sudah ada.` });
      }
    }

    // --- Controller-side Validation for Update ---
    const errors = [];
    if (updateData.name !== undefined && (typeof updateData.name !== 'string' || updateData.name.trim() === '')) {
      errors.push('Nama harus berupa string non-kosong jika disediakan.');
    } else if (updateData.name !== undefined) {
      updateData.name = updateData.name.trim(); // Trim name if provided
    }

    if (updateData.isActive !== undefined && typeof updateData.isActive !== 'boolean') {
      errors.push('isActive harus berupa boolean jika disediakan.');
    }

    // Validate address fields if provided
    if (updateData.address !== undefined) {
      if (!updateData.address.province || updateData.address.province.trim() === '') errors.push('Provinsi alamat wajib diisi.');
      if (!updateData.address.regency || updateData.address.regency.trim() === '') errors.push('Kabupaten/Kota alamat wajib diisi.');
      if (!updateData.address.district || updateData.address.district.trim() === '') errors.push('Kecamatan alamat wajib diisi.');
      if (!updateData.address.village || updateData.address.village.trim() === '') errors.push('Desa/Kelurahan alamat wajib diisi.');
      if (!updateData.address.street || updateData.address.street.trim() === '') errors.push('Jalan alamat wajib diisi.');

      // Trim address fields if they exist in updateData
      if (updateData.address) {
        updateData.address.province = updateData.address.province?.trim();
        updateData.address.regency = updateData.address.regency?.trim();
        updateData.address.district = updateData.address.district?.trim();
        updateData.address.village = updateData.address.village?.trim();
        updateData.address.street = updateData.address.street?.trim();
      }
    }

    if (updateData.imgUrl !== undefined && typeof updateData.imgUrl !== 'string') {
      errors.push('imgUrl harus berupa string.');
    } else if (updateData.imgUrl !== undefined) {
      updateData.imgUrl = updateData.imgUrl.trim();
    }

    if (updateData.foundedAt !== undefined && isNaN(new Date(updateData.foundedAt).getTime())) {
      errors.push('Tanggal didirikan tidak valid jika disediakan.');
    }

    // Validate user lists and their roles if provided
    await validateUsersAndRoles(updateData.franchisees, Roles.franchisee, errors, 'Penerima Waralaba');
    await validateUsersAndRoles(updateData.operators, Roles.operator, errors, 'Operator');
    await validateUsersAndRoles(updateData.spvAreas, Roles.spvarea, errors, 'SPV Area');

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal', errors });
    }
    // --- End Controller-side Validation ---

    const outlet = await Outlet.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true } // runValidators to trigger schema validation
    );

    if (!outlet) {
      return res.status(404).json({ message: 'Outlet tidak ditemukan' });
    }

    res.status(200).json({
      message: 'Outlet berhasil diperbarui',
      outlet: outlet.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Format ID Outlet tidak valid.' });
    }
    if (error.code === 11000) { // Duplicate key error for 'name'
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({ message: `Outlet dengan ${field} '${value}' ini sudah ada.` });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal', errors });
    }
    console.error('Error updating outlet:', error);
    res.status(500).json({ message: 'Kesalahan server saat memperbarui outlet', error: error.message });
  }
};

// @desc    Soft delete an outlet by ID
// @route   DELETE /api/v1/outlets/:id
// @access  private/Admin
export const deleteOutlet = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Outlet tidak valid.' });
    }

    const outlet = await Outlet.findByIdAndUpdate(
      id,
      { isDeleted: true, deletedAt: new Date() /* , deletedBy: req.user.id */ },
      { new: true }
    );

    if (!outlet) {
      return res.status(404).json({ message: 'Outlet tidak ditemukan' });
    }

    res.status(200).json({
      message: 'Outlet berhasil dihapus secara lunak',
      outlet: outlet.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Format ID Outlet tidak valid.' });
    }
    console.error('Error soft deleting outlet:', error);
    res.status(500).json({ message: 'Kesalahan server saat menghapus outlet secara lunak', error: error.message });
  }
};

// @desc    Get outlets associated with a specific Operator user ID
// @route   GET /api/v1/outlets/operator/:operatorId
// @access  Private
export const getOutletsByOperator = async (req, res) => {
  try {
    const { operatorId } = req.params;

    // Validate the provided operatorId
    if (!mongoose.Types.ObjectId.isValid(operatorId)) {
      return res.status(400).json({ message: 'Format ID Pengguna Operator tidak valid.' });
    }

    const filter = {
      isDeleted: false,
      operators: operatorId // Filter by operator ID directly
    };

    // Add optional query parameters from req.query (isActive, name, code)
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }
    if (req.query.name) {
      filter.name = { $regex: req.query.name, $options: 'i' };
    }
    if (req.query.code) {
      filter.code = { $regex: req.query.code, $options: 'i' };
    }

    const query = Outlet.find(filter).sort({ createdAt: -1 });

    query.populate('franchisees', 'name userId')
      .populate('operators', 'name userId')
      .populate('spvAreas', 'name userId');

    const outlets = await query.exec();
    res.status(200).json(outlets.map(outlet => outlet.toJSON()));

  } catch (error) {
    console.error('Error getting outlets by operator ID:', error);
    res.status(500).json({ message: 'Kesalahan server saat mendapatkan outlet berdasarkan ID Operator', error: error.message });
  }
};

// @desc    Get outlets associated with a specific Franchisee user ID
// @route   GET /api/v1/outlets/franchisee/:franchiseeId
// @access  Private
export const getOutletsByFranchisee = async (req, res) => {
  try {
    const { franchiseeId } = req.params;

    // Validate the provided franchiseeId
    if (!mongoose.Types.ObjectId.isValid(franchiseeId)) {
      return res.status(400).json({ message: 'Format ID Pengguna Penerima Waralaba tidak valid.' });
    }

    const filter = {
      isDeleted: false,
      franchisees: franchiseeId // Filter by franchisee ID directly
    };

    // Add optional query parameters from req.query (isActive, name, code)
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }
    if (req.query.name) {
      filter.name = { $regex: req.query.name, $options: 'i' };
    }
    if (req.query.code) {
      filter.code = { $regex: req.query.code, $options: 'i' };
    }

    const query = Outlet.find(filter).sort({ createdAt: -1 });

    query.populate('franchisees', 'name userId')
      .populate('operators', 'name userId')
      .populate('spvAreas', 'name userId');

    const outlets = await query.exec();
    res.status(200).json(outlets.map(outlet => outlet.toJSON()));

  } catch (error) {
    console.error('Error getting outlets by franchisee ID:', error);
    res.status(500).json({ message: 'Kesalahan server saat mendapatkan outlet berdasarkan ID Penerima Waralaba', error: error.message });
  }
};

// @desc    Get outlets associated with a specific SPV Area user ID
// @route   GET /api/v1/outlets/spvarea/:spvAreaId
// @access  Private
export const getOutletsBySpvArea = async (req, res) => {
  try {
    const { spvAreaId } = req.params;

    // Validate the provided spvAreaId
    if (!mongoose.Types.ObjectId.isValid(spvAreaId)) {
      return res.status(400).json({ message: 'Format ID Pengguna SPV Area tidak valid.' });
    }

    const filter = {
      isDeleted: false,
      spvAreas: spvAreaId // Filter by SPV Area ID directly
    };

    // Add optional query parameters from req.query (isActive, name, code)
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }
    if (req.query.name) {
      filter.name = { $regex: req.query.name, $options: 'i' };
    }
    if (req.query.code) {
      filter.code = { $regex: req.query.code, $options: 'i' };
    }

    const query = Outlet.find(filter).sort({ createdAt: -1 });

    query.populate('franchisees', 'name userId')
      .populate('operators', 'name userId')
      .populate('spvAreas', 'name userId');

    const outlets = await query.exec();
    res.status(200).json(outlets.map(outlet => outlet.toJSON()));

  } catch (error) {
    console.error('Error getting outlets by SPV Area ID:', error);
    res.status(500).json({ message: 'Kesalahan server saat mendapatkan outlet berdasarkan ID SPV Area', error: error.message });
  }
};