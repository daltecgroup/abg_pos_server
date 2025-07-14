// controllers/menuController.js

import Menu from '../models/Menu.js';
import MenuCategory from '../models/MenuCategory.js'; // For category validation
import Ingredient from '../models/Ingredient.js'; // NEW: For ingredient validation in recipe
import mongoose from 'mongoose'; // For ObjectId validation
import * as productCompositionService from '../services/productCompositionService.js'; // NEW: Import the new service

// --- CRUD Controller Functions for Menu ---

// @desc    Create a new menu
// @route   POST /api/menus
// @access  Public (in a real app, typically Private/Admin and authenticated)
export const createMenu = async (req, res) => {
  try {
    const { name, menuCategoryId, description, price, recipe, image, isActive } = req.body;

    // --- Controller-side Validation for Create ---
    const errors = [];

    if (!name || name.trim() === '') {
      errors.push('Nama menu diperlukan.');
    }
    if (!menuCategoryId || !mongoose.Types.ObjectId.isValid(menuCategoryId)) {
      errors.push('ID Kategori Menu tidak valid.');
    } else {
      const existingCategory = await MenuCategory.findById(menuCategoryId);
      if (!existingCategory || existingCategory.isDeleted || !existingCategory.isActive) {
        errors.push('Kategori menu yang disediakan tidak ditemukan, sudah dihapus, atau tidak aktif.');
      }
    }
    if (price === undefined || typeof price !== 'number' || price < 0) {
      errors.push('Harga menu diperlukan dan harus berupa angka non-negatif.');
    }
    if (description !== undefined && typeof description !== 'string') {
      errors.push('Deskripsi harus berupa string.');
    } else if (description !== undefined) {
      req.body.description = description.trim();
    }
    if (image !== undefined && typeof image !== 'string') {
      errors.push('URL gambar harus berupa string.');
    } else if (image !== undefined) {
      req.body.image = image.trim();
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      errors.push('isActive harus berupa boolean jika disediakan.');
    }

    // NEW: Use productCompositionService to validate recipe
    if (recipe !== undefined) {
      const processedRecipe = await productCompositionService.validateRecipeArray(recipe, errors);
      if (processedRecipe) {
        req.body.recipe = processedRecipe; // Replace with validated/processed recipe
      } else {
        // Errors were pushed to the 'errors' array by the service function
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    // --- End Controller-side Validation ---

    // Trim name before creating
    req.body.name = req.body.name.trim();

    const menu = await Menu.create(req.body); // Code will be set by pre-save hook
    res.status(201).json({
      message: 'Menu berhasil dibuat.',
      menu: menu.toJSON()
    });
  } catch (error) {
    if (error.code === 11000) { // Duplicate key error for 'code' or 'name'
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({ message: `Menu dengan ${field} '${value}' sudah ada.` });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    console.error('Kesalahan saat membuat menu:', error);
    res.status(500).json({ message: 'Kesalahan server saat membuat menu.', error: error.message });
  }
};

// @desc    Get all menus
// @route   GET /api/menus
// @access  Public
export const getMenus = async (req, res) => {
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
    if (req.query.menuCategoryId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.menuCategoryId)) {
        return res.status(400).json({ message: 'ID Kategori Menu tidak valid untuk filter.' });
      }
      filter.menuCategoryId = req.query.menuCategoryId;
    }

    const query = Menu.find(filter).sort({ createdAt: -1 });

    // Populate menu category and recipe ingredients if requested
    const populateFields = req.query.populate;
    if (populateFields) {
      if (populateFields.includes('menuCategoryId')) query.populate('menuCategoryId', 'name');
      if (populateFields.includes('recipe')) query.populate('recipe.ingredientId', 'name unit price');
    } else {
      // Default populate commonly needed fields
      // query.populate('menuCategoryId', 'name');
    }


    const menus = await query.exec();
    res.status(200).json(menus.map(menu => menu.toJSON()));
  } catch (error) {
    console.error('Kesalahan saat mengambil menu:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengambil menu.', error: error.message });
  }
};

// @desc    Get a single menu by ID
// @route   GET /api/menus/:id
// @access  Public
export const getMenuById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Menu tidak valid.' });
    }

    const menu = await Menu.findById(id)
      .populate('menuCategoryId', 'name')
      .populate('recipe.ingredientId', 'name unit price'); // Populate ingredient details for recipe;

    if (!menu || menu.isDeleted === true) {
      return res.status(404).json({ message: 'Menu tidak ditemukan atau sudah dihapus.' });
    }
    res.status(200).json(menu.toJSON());
  } catch (error) {
    console.error('Kesalahan saat mengambil menu berdasarkan ID:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengambil menu.', error: error.message });
  }
};

// @desc    Update a menu by ID
// @route   PUT /api/menus/:id
// @access  Public (in a real app, typically Private/Admin and authenticated)
export const updateMenu = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Menu tidak valid.' });
    }
    console.log(updateData);

    // --- Controller-side Validation for Update ---
    const errors = [];
    if (updateData.name !== undefined && (typeof updateData.name !== 'string' || updateData.name.trim() === '')) {
      errors.push('Nama harus berupa string non-kosong jika disediakan.');
    } else if (updateData.name !== undefined) {
      updateData.name = updateData.name.trim(); // Trim name if provided
    }

    if (updateData.menuCategoryId !== undefined) {
      if (!mongoose.Types.ObjectId.isValid(updateData.menuCategoryId)) {
        errors.push('ID Kategori Menu tidak valid.');
      } else {
        const existingCategory = await MenuCategory.findById(updateData.menuCategoryId);
        if (!existingCategory || existingCategory.isDeleted || !existingCategory.isActive) {
          errors.push('Kategori menu yang disediakan tidak ditemukan, sudah dihapus, atau tidak aktif.');
        }
      }
    }
    if (updateData.price !== undefined && (typeof updateData.price !== 'number' || updateData.price < 0)) {
      errors.push('Harga harus berupa angka non-negatif jika disediakan.');
    }
    if (updateData.description !== undefined && typeof updateData.description !== 'string') {
      errors.push('Deskripsi harus berupa string.');
    } else if (updateData.description !== undefined) {
      updateData.description = updateData.description.trim();
    }
    if (updateData.image !== undefined && typeof updateData.image !== 'string') {
      errors.push('URL gambar harus berupa string.');
    } else if (updateData.image !== undefined) {
      updateData.image = updateData.image.trim();
    }
    if (updateData.isActive !== undefined && typeof updateData.isActive !== 'boolean') {
      errors.push('isActive harus berupa boolean jika disediakan.');
    }

    // NEW: Use productCompositionService to validate recipe ingredients for update
    if (updateData.recipe !== undefined) {
      const processedRecipe = await productCompositionService.validateRecipeArray(updateData.recipe, errors);
      if (processedRecipe) {
        updateData.recipe = processedRecipe; // Replace with validated/processed recipe
      } else {
        // Errors were pushed to the 'errors' array by the service function
      }
    }


    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    // --- End Controller-side Validation ---

    const menu = await Menu.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true } // runValidators to trigger schema validation
    );

    if (!menu) {
      return res.status(404).json({ message: 'Menu tidak ditemukan.' });
    }

    res.status(200).json({
      message: 'Menu berhasil diperbarui.',
      menu: menu.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Format ID Menu tidak valid.' });
    }
    if (error.code === 11000) { // Duplicate key error for 'code' or 'name'
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({ message: `Menu dengan ${field} '${value}' sudah ada.` });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    console.error('Kesalahan saat memperbarui menu:', error);
    res.status(500).json({ message: 'Kesalahan server saat memperbarui menu.', error: error.message });
  }
};

// @desc    Soft delete a menu by ID
// @route   DELETE /api/menus/:id
// @access  Public (in a real app, typically Private/Admin and authenticated)
export const deleteMenu = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Menu tidak valid.' });
    }

    const menu = await Menu.findByIdAndUpdate(
      id,
      { isDeleted: true, deletedAt: new Date() /* , deletedBy: req.user.id */ },
      { new: true }
    );

    if (!menu) {
      return res.status(404).json({ message: 'Menu tidak ditemukan.' });
    }

    res.status(200).json({
      message: 'Menu berhasil dihapus (soft delete).',
      menu: menu.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Format ID Menu tidak valid.' });
    }
    console.error('Kesalahan saat menghapus menu:', error);
    res.status(500).json({ message: 'Kesalahan server saat menghapus menu.', error: error.message });
  }
};
