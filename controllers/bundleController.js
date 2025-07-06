import Bundle from '../models/Bundle.js'; // Import the Bundle model
import MenuCategory from '../models/MenuCategory.js'; // Import for category validation
import mongoose from 'mongoose'; // For ObjectId validation
import * as productCompositionService from '../services/productCompositionService.js'; // NEW: Import the new service


// --- CRUD Controller Functions for Bundle ---

// @desc    Create a new bundle
// @route   POST /api/bundles
// @access  Public (in a real app, typically Private/Admin and authenticated)
export const createBundle = async (req, res) => {
  try {
    const { name, price, categories, description, isActive } = req.body;

    // --- Controller-side Validation for Create ---
    const errors = [];

    if (!name || name.trim() === '') {
      errors.push('Nama paket diperlukan.');
    }
    if (price === undefined || typeof price !== 'number' || price < 0) {
      errors.push('Harga paket diperlukan dan harus berupa angka non-negatif.');
    }

    // NEW: Use productCompositionService to validate categories
    if (categories !== undefined) {
      const processedCategories = await productCompositionService.validateBundleCategoriesArray(categories, errors);
      if (processedCategories) {
        req.body.categories = processedCategories; // Replace with validated/processed categories
      } else {
        // Errors were pushed to the 'errors' array by the service function
      }
    }


    if (description !== undefined && typeof description !== 'string') {
        errors.push('Deskripsi harus berupa string.');
    } else if (description !== undefined) {
        req.body.description = description.trim(); // Trim description if provided
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      errors.push('isActive harus berupa boolean jika disediakan.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    // --- End Controller-side Validation ---

    // Trim name before creating
    req.body.name = req.body.name.trim();

    const bundle = await Bundle.create(req.body); // Code will be set by pre-save hook
    res.status(201).json({
      message: 'Paket berhasil dibuat.',
      bundle: bundle.toJSON()
    });
  } catch (error) {
    if (error.code === 11000) { // Duplicate key error for 'name'
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({ message: `Paket dengan ${field} '${value}' sudah ada.` });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    console.error('Kesalahan saat membuat paket:', error);
    res.status(500).json({ message: 'Kesalahan server saat membuat paket.', error: error.message });
  }
};

// @desc    Get all bundles
// @route   GET /api/bundles
// @access  Public
export const getBundles = async (req, res) => {
  try {
    const filter = { isDeleted: false }; // Default: get non-deleted bundles
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }
    if (req.query.name) {
      filter.name = { $regex: req.query.name, $options: 'i' };
    }
    if (req.query.code) {
      filter.code = { $regex: req.query.code, $options: 'i' };
    }
    // You might add filtering by category IDs if needed (e.g., /api/bundles?categoryId=id1)

    const query = Bundle.find(filter).sort({ createdAt: -1 });

    // Populate categories if requested or always
    const populateFields = req.query.populate;
    if (populateFields) {
        if (populateFields.includes('categories')) query.populate('categories.menuCategoryId', 'name'); // Only fetch 'name' field of menu category
    } else {
        // Default to populate categories
        // query.populate('categories.menuCategoryId');
    }

    const bundles = await query.exec();
    res.status(200).json(bundles.map(bundle => bundle.toJSON()));
  } catch (error) {
    console.error('Kesalahan saat mengambil paket:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengambil paket.', error: error.message });
  }
};

// @desc    Get a single bundle by ID
// @route   GET /api/bundles/:id
// @access  Public
export const getBundleById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Paket tidak valid.' });
    }

    const bundle = await Bundle.findById(id)
                          .populate('categories.menuCategoryId', 'name'); // Populate categories

    if (!bundle || bundle.isDeleted === true) {
      return res.status(404).json({ message: 'Paket tidak ditemukan atau sudah dihapus.' });
    }
    res.status(200).json(bundle.toJSON());
  } catch (error) {
    console.error('Kesalahan saat mengambil paket berdasarkan ID:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengambil paket berdasarkan ID.', error: error.message });
  }
};

// @desc    Update a bundle by ID
// @route   PUT /api/bundles/:id
// @access  Public (in a real app, typically Private/Admin and authenticated)
export const updateBundle = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Paket tidak valid.' });
    }

    // --- Controller-side Validation for Update ---
    const errors = [];
    if (updateData.name !== undefined && (typeof updateData.name !== 'string' || updateData.name.trim() === '')) {
      errors.push('Nama harus berupa string non-kosong jika disediakan.');
    } else if (updateData.name !== undefined) {
      updateData.name = updateData.name.trim(); // Trim name if provided
    }

    if (updateData.price !== undefined && (typeof updateData.price !== 'number' || updateData.price < 0)) {
      errors.push('Harga harus berupa angka non-negatif jika disediakan.');
    }
    if (updateData.categories !== undefined) {
      const processedCategories = await productCompositionService.validateBundleCategoriesArray(updateData.categories, errors);
      if (processedCategories) {
        updateData.categories = processedCategories; // Replace with validated/processed categories
      } else {
        // Errors were pushed to the 'errors' array by the service function
      }
    }
    if (updateData.description !== undefined && typeof updateData.description !== 'string') {
        errors.push('Deskripsi harus berupa string.');
    } else if (updateData.description !== undefined) {
        updateData.description = updateData.description.trim();
    }
    if (updateData.isActive !== undefined && typeof updateData.isActive !== 'boolean') {
      errors.push('isActive harus berupa boolean jika disediakan.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    // --- End Controller-side Validation ---

    const bundle = await Bundle.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true } // runValidators to trigger schema validation
    );

    if (!bundle) {
      return res.status(404).json({ message: 'Paket tidak ditemukan.' });
    }

    res.status(200).json({
      message: 'Paket berhasil diperbarui.',
      bundle: bundle.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Format ID Paket tidak valid.' });
    }
    if (error.code === 11000) { // Duplicate key error for 'name'
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({ message: `Paket dengan ${field} '${value}' sudah ada.` });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    console.error('Kesalahan saat memperbarui paket:', error);
    res.status(500).json({ message: 'Kesalahan server saat memperbarui paket.', error: error.message });
  }
};

// @desc    Soft delete a bundle by ID
// @route   DELETE /api/bundles/:id
// @access  Public (in a real app, typically Private/Admin and authenticated)
export const deleteBundle = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Paket tidak valid.' });
    }

    const bundle = await Bundle.findByIdAndUpdate(
      id,
      { isDeleted: true, deletedAt: new Date() /* , deletedBy: req.user.id */ },
      { new: true }
    );

    if (!bundle) {
      return res.status(404).json({ message: 'Paket tidak ditemukan.' });
    }

    res.status(200).json({
      message: 'Paket berhasil dihapus (soft delete).',
      bundle: bundle.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Format ID Paket tidak valid.' });
    }
    console.error('Kesalahan saat menghapus paket:', error);
    res.status(500).json({ message: 'Kesalahan server saat menghapus paket.', error: error.message });
  }
};
