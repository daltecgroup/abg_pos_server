import Addon from '../models/Addon.js';
import mongoose from 'mongoose'; // For ObjectId validation
import Ingredient from '../models/Ingredient.js'; // Needed for ingredient validation in recipe
import * as productCompositionService from '../services/productCompositionService.js'; // NEW: Import the new service

// --- CRUD Controller Functions for Addon ---

// @desc    Create a new addon
// @route   POST /api/v1/addons
// @access  Public (in a real app, typically Private/Admin and authenticated)
export const createAddon = async (req, res) => {
  try {
    const { name, price, isActive, recipe } = req.body;

    const errors = [];

    // Basic validation
    if (!name || name.trim() === '') {
      errors.push('Nama addon diperlukan.');
    }
    if (price === undefined || typeof price !== 'number' || price < 0) {
      errors.push('Harga addon diperlukan dan harus berupa angka non-negatif.');
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      errors.push('isActive harus berupa boolean jika disediakan.');
    }

    // NEW: Use productCompositionService to validate recipe ingredients
    if (recipe !== undefined) {
      const processedRecipe = await productCompositionService.validateRecipeArray(recipe, errors);
      if (processedRecipe) {
        req.body.recipe = processedRecipe; // Replace with validated/processed recipe
      } else {
        // Errors were pushed to the 'errors' array by the service function
      }
    }

    const existingName = await Addon.find({
      name,
      isDeleted: false
    });

    if (existingName.length > 0) {
      return res.status(409).json({ message: `Addon dengan nama '${name}' sudah ada.` });
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }

    // Trim name before creating
    req.body.name = req.body.name.trim();

    const addon = await Addon.create(req.body); // Code will be set by pre-save hook
    res.status(201).json({
      message: 'Addon berhasil dibuat.',
      addon: addon.toJSON()
    });
  } catch (error) {
    if (error.code === 11000) { // Duplicate key error for 'code' or 'name'
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({ message: `Addon dengan ${field} '${value}' sudah ada.` });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    console.error('Kesalahan saat membuat addon:', error);
    res.status(500).json({ message: 'Kesalahan server saat membuat addon.', error: error.message });
  }
};

// @desc    Get all addons
// @route   GET /api/v1/addons
// @access  Public
export const getAddons = async (req, res) => {
  try {
    const filter = { isDeleted: false };
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }
    if (req.query.name) {
      filter.name = { $regex: req.query.name, $options: 'i' };
    }
    if (req.query.code) {
      filter.code = { $regex: req.query.code, $options: 'i' };
    }

    const query = Addon.find(filter).sort({ createdAt: -1 });

    // Populate recipe ingredients if the Addon model includes a recipe field and it's requested
    const populateFields = req.query.populate;
    if (populateFields && populateFields.includes('recipe')) {
      query.populate('recipe.ingredientId');
    }

    const addons = await query.exec();
    res.status(200).json(addons.map(addon => addon.toJSON()));
  } catch (error) {
    console.error('Kesalahan saat mengambil addons:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengambil addons.', error: error.message });
  }
};

// @desc    Get a single addon by ID
// @route   GET /api/v1/addons/:id
// @access  Public
export const getAddonById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Addon tidak valid.' });
    }

    const addon = await Addon.findById(id)
      .populate('recipe.ingredientId', 'name unit price'); // NEW: Populate recipe if it exists;

    if (!addon || addon.isDeleted === true) {
      return res.status(404).json({ message: 'Addon tidak ditemukan atau sudah dihapus.' });
    }
    res.status(200).json(addon.toJSON());
  } catch (error) {
    console.error('Kesalahan saat mengambil addon berdasarkan ID:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengambil addon.', error: error.message });
  }
};

// @desc    Update an addon by ID
// @route   PUT /api/v1/addons/:id
// @access  Public (in a real app, typically Private/Admin and authenticated)
export const updateAddon = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Addon tidak valid.' });
    }

    const errors = [];
    if (updateData.name !== undefined && (typeof updateData.name !== 'string' || updateData.name.trim() === '')) {
      errors.push('Nama harus berupa string non-kosong jika disediakan.');
    } else if (updateData.name !== undefined) {
      updateData.name = updateData.name.trim(); // Trim name if provided
    }

    if (updateData.price !== undefined && (typeof updateData.price !== 'number' || updateData.price < 0)) {
      errors.push('Harga harus berupa angka non-negatif jika disediakan.');
    }
    if (updateData.isActive !== undefined && typeof updateData.isActive !== 'boolean') {
      errors.push('isActive harus berupa boolean jika disediakan.');
    }

    // NEW: Use productCompositionService to validate recipe ingredients on Update
    if (updateData.recipe !== undefined) {
      const processedRecipe = await productCompositionService.validateRecipeArray(updateData.recipe, errors);
      if (processedRecipe) {
        updateData.recipe = processedRecipe; // Replace with validated/processed recipe
      } else {
        // Errors were pushed to the 'errors' array by the service function
      }
    }

    if (updateData.name !== undefined && typeof updateData.name === 'string') {
      const existingName = await Addon.find({
        _id: { $ne: id },
        name: updateData.name,
        isDeleted: false
      });
      if (existingName.length > 0) {
        return res.status(409).json({ message: `Addon dengan nama '${updateData.name}' sudah ada.` });
      }
    }



    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }

    const addon = await Addon.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true } // runValidators to trigger schema validation
    ).populate('recipe.ingredientId');

    if (!addon) {
      return res.status(404).json({ message: 'Addon tidak ditemukan.' });
    }

    res.status(200).json({
      message: 'Addon berhasil diperbarui.',
      addon: addon.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Format ID Addon tidak valid.' });
    }
    if (error.code === 11000) { // Duplicate key error for 'code' or 'name'
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({ message: `Addon dengan ${field} '${value}' sudah ada.` });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    console.error('Kesalahan saat memperbarui addon:', error);
    res.status(500).json({ message: 'Kesalahan server saat memperbarui addon.', error: error.message });
  }
};

// @desc    Soft delete an addon by ID
// @route   DELETE /api/v1/addons/:id
// @access  Public (in a real app, typically Private/Admin and authenticated)
export const deleteAddon = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Addon tidak valid.' });
    }

    const addon = await Addon.findByIdAndUpdate(
      id,
      { isDeleted: true, deletedAt: new Date() /* , deletedBy: req.user.id */ },
      { new: true }
    );

    if (!addon) {
      return res.status(404).json({ message: 'Addon tidak ditemukan.' });
    }

    res.status(200).json({
      message: 'Addon berhasil dihapus (soft delete).',
      addon: addon.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Format ID Addon tidak valid.' });
    }
    console.error('Kesalahan saat menghapus addon:', error);
    res.status(500).json({ message: 'Kesalahan server saat menghapus addon.', error: error.message });
  }
};
