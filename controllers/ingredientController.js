import Ingredient from '../models/Ingredient.js';
import IngredientHistory from '../models/IngredientHistory.js';
import mongoose from 'mongoose';

// @desc    Create a new ingredient
// @route   POST /api/v1/ingredients
// @access  Private/Admin
export const createIngredient = async (req, res) => {
  try {
    const { name, price } = req.body;

    if (!name || name.trim() === '') {
        return res.status(400).json({ message: 'Nama diperlukan.' });
    }
    const existingIngredient = await Ingredient.findOne({ name: name.trim().toLowerCase() });
    if (existingIngredient) {
        return res.status(409).json({ message: `Bahan dengan nama '${name}' sudah ada.` });
    }
    if (price === undefined || price < 0) {
        return res.status(400).json({ message: 'Harga diperlukan dan harus non-negatif.' });
    }
    const ingredient = await Ingredient.create(req.body);
    res.status(201).json({
      message: 'Bahan berhasil dibuat',
      ingredient: ingredient.toJSON()
    });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({ message: `Bahan dengan ${field} '${value}' ini sudah ada.` });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal', errors });
    }
    console.error('Error creating ingredient:', error);
    res.status(500).json({ message: 'Kesalahan server saat membuat bahan', error: error.message });
  }
};

// @desc    Get all ingredients
// @route   GET /api/v1/ingredients
// @access  Public
export const getIngredients = async (req, res) => {
  try {
    let filter = { isDeleted: false };
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive;
    } 
    if (req.query.name) {
      filter.name = { $regex: req.query.name, $options: 'i' };
    }
    if (req.query.code) {
      filter.code = { $regex: req.query.code, $options: 'i' };
    }
    const ingredients = await Ingredient.find(filter).sort({ name: 'asc' });
    res.status(200).json(ingredients.map(ing => ing.toJSON()));
  } catch (error) {
    console.error('Error getting ingredients:', error);
    res.status(500).json({ message: 'Kesalahan server saat mendapatkan bahan', error: error.message });
  }
};

// @desc    Get a single ingredient by ID
// @route   GET /api/v1/ingredients/:id
// @access  Public
export const getIngredientById = async (req, res) => {
  try {
    const ingredient = await Ingredient.findById(req.params.id);
    if (!ingredient || ingredient.isDeleted === true) {
      return res.status(404).json({ message: 'Bahan tidak ditemukan atau sudah dihapus' });
    }
    res.status(200).json(ingredient.toJSON());
  } catch (error) {
    console.error('Error getting ingredient by ID:', error);
    res.status(500).json({ message: 'Kesalahan server saat mendapatkan bahan', error: error.message });
  }
};

// @desc    Update an ingredient by ID
// @route   PUT /api/v1/ingredients/:id
// @access  Private/Admin
export const updateIngredient = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    // check if there is existing ingredient with the same name
    if (updateData.name) {
      const existingIngredient = await Ingredient.findOne({
        name: updateData.name.trim().toLowerCase(),
        _id: { $ne: id } // Exclude current ingredient
      });
      if (existingIngredient) {
        return res.status(409).json({ message: `Bahan dengan nama '${updateData.name}' sudah ada.` });
      }
    }

    const options = { new: true, runValidators: true };
    if (req.user) {
      options.context = { user: { id: req.user._id, name: req.user.name || 'Unknown' } };
    }

    const ingredient = await Ingredient.findByIdAndUpdate(
      id,
      updateData,
      options,
      { new: true, runValidators: true }
    );

    if (!ingredient) {
      return res.status(404).json({ message: 'Bahan tidak ditemukan' });
    }

    res.status(200).json({
      message: 'Bahan berhasil diperbarui',
      ingredient: ingredient.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Format ID Bahan tidak valid.' });
    }
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({ message: `Bahan dengan ${field} '${value}' ini sudah ada.` });
    }
    // Handle Mongoose validation errors for updates
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal', errors });
    }
    console.error('Error updating ingredient:', error);
    res.status(500).json({ message: 'Kesalahan server saat memperbarui bahan', error: error.message });
  }
};

// @desc    Soft delete an ingredient by ID (sets isDeleted to true)
// @route   DELETE /api/v1/ingredients/:id
// @access  Public (in a real app, typically Private/Admin and authenticated)
export const deleteIngredient = async (req, res) => {
  try {
    const { id } = req.params;
    const ingredient = await Ingredient.findByIdAndUpdate(
      id,
      { isDeleted: true, deletedAt: new Date(), deletedBy: req.user.id },
      { new: true }
    );

    if (!ingredient) {
      return res.status(404).json({ message: 'Bahan tidak ditemukan' });
    }

    res.status(200).json({
      message: 'Bahan berhasil dihapus secara lunak',
      ingredient: ingredient.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Format ID Bahan tidak valid.' });
    }
    console.error('Error soft deleting ingredient:', error);
    res.status(500).json({ message: 'Kesalahan server saat menghapus bahan secara lunak', error: error.message });
  }
};

// @desc    Get all ingredient history for a specific ingredient ID
// @route   GET /api/v1/ingredients/:id/history
// @access  Public (in a real app, typically Private/Admin)
export const getIngredientHistory = async (req, res) => {
  try {
    const { id } = req.params;
    // Validate if the ID is a valid MongoDB ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid Ingredient ID format.' });
    }

    // Find history records for the given ingredientId, sorted by creation date
    const history = await IngredientHistory.find({ ingredientId: id })
                                         .sort({ createdAt: -1 }); // Ascending order to see history unfold
    res.status(200).json(history.map(item => item.toJSON()));
  } catch (error) {
    console.error('Error fetching ingredient history:', error);
    res.status(500).json({ message: 'Server error fetching ingredient history', error: error.message });
  }
};