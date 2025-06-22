import Menu from '../models/Menu.js'; // Import the Menu model
import MenuCategory from '../models/MenuCategory.js'; // Import for category validation
import Ingredient from '../models/Ingredient.js'; // Import for ingredient validation
import mongoose from 'mongoose'; // For ObjectId validation

// --- CRUD Controller Functions for Menu ---

// @desc    Create a new menu item
// @route   POST /api/v1/menus
// @access  Private/Admin
export const createMenu = async (req, res) => {
  try {
    const { name, price, discount, description, imgUrl, category, ingredients, isActive } = req.body;

    // --- Controller-side Validation for Create ---
    const errors = [];

    if (!name || name.trim() === '') {
      errors.push('Nama diperlukan.');
    }
    if (price === undefined || typeof price !== 'number' || price < 0) {
      errors.push('Harga diperlukan dan harus berupa angka non-negatif.');
    }
    if (discount !== undefined && (typeof discount !== 'number' || discount < 0 || discount > 100)) {
      errors.push('Diskon harus berupa angka antara 0 dan 100.');
    }
    if (!category || !mongoose.Types.ObjectId.isValid(category)) {
      errors.push('ID Kategori yang valid diperlukan.');
    } else {
      // Check if category actually exists
      const existingCategory = await MenuCategory.findById(category);
      if (!existingCategory || existingCategory.isDeleted) {
        errors.push('Kategori yang disediakan tidak ada atau sudah dihapus.');
      }
    }
    if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
      errors.push('Bahan-bahan diperlukan dan harus berupa array dengan setidaknya satu item.');
    } else {
      // Validate each ingredient item in the array
      for (let i = 0; i < ingredients.length; i++) {
        const item = ingredients[i];
        if (!item.ingredientId || !mongoose.Types.ObjectId.isValid(item.ingredientId)) {
          errors.push(`Bahan pada indeks ${i} memiliki ingredientId yang tidak valid.`);
        } else {
          // Check if ingredient actually exists
          const existingIngredient = await Ingredient.findById(item.ingredientId);
          if (!existingIngredient || existingIngredient.isDeleted || !existingIngredient.isActive) {
            errors.push(`ID Bahan '${item.ingredientId}' pada indeks ${i} tidak ada, sudah dihapus, atau tidak aktif.`);
          }
        }
        if (item.qty === undefined || typeof item.qty !== 'number' || item.qty <= 0) {
          errors.push(`Kuantitas untuk bahan pada indeks ${i} diperlukan dan harus berupa angka positif.`);
        }
      }
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      errors.push('isActive harus berupa boolean jika disediakan.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal', errors });
    }
    // --- End Controller-side Validation ---

    // Apply trimming to name if provided
    const menuData = {
      ...req.body,
      name: name.trim(),
    };

    const menu = await Menu.create(menuData); // Code will be set by pre-save hook
    res.status(201).json({
      message: 'Item menu berhasil dibuat',
      menu: menu.toJSON()
    });
  } catch (error) {
    if (error.code === 11000) { // Duplicate key error for 'name'
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({ message: `Item menu dengan ${field} '${value}' ini sudah ada.` });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal', errors });
    }
    console.error('Error creating menu item:', error);
    res.status(500).json({ message: 'Kesalahan server saat membuat item menu', error: error.message });
  }
};

// @desc    Get all menu items
// @route   GET /api/v1/menus
// @access  Public
export const getMenus = async (req, res) => {
  try {
    const filter = { isDeleted: false }; // Default: get non-deleted menus
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }
    if (req.query.name) {
      filter.name = { $regex: req.query.name, $options: 'i' };
    }
    if (req.query.code) {
      filter.code = { $regex: req.query.code, $options: 'i' };
    }
    if (req.query.category) {
      if (!mongoose.Types.ObjectId.isValid(req.query.category)) {
        return res.status(400).json({ message: 'Format ID Kategori tidak valid.' });
      }
      filter.category = req.query.category;
    }

    const query = Menu.find(filter).sort({ createdAt: -1 });

    // Populate category and ingredients if requested or always
    // You might want to make this optional via query parameters (e.g., ?populate=category,ingredients)
    const populateFields = req.query.populate;
    if (populateFields) {
      if (populateFields.includes('category')) {
        query.populate('category', 'name'); // Only fetch 'name' field of category
      }
      if (populateFields.includes('ingredients')) {
        query.populate('ingredients.ingredientId', 'name unit'); // Only fetch 'name' and 'unit' of ingredient
      }
    } else {
        // Default to populate commonly needed fields if no populate param
        query.populate('category', 'name').populate('ingredients.ingredientId', 'name unit');
    }

    const menus = await query.exec();
    res.status(200).json(menus.map(menu => menu.toJSON()));
  } catch (error) {
    console.error('Error getting menu items:', error);
    res.status(500).json({ message: 'Kesalahan server saat mendapatkan item menu', error: error.message });
  }
};

// @desc    Get a single menu item by ID
// @route   GET /api/v1/menus/:id
// @access  Public
export const getMenuById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Menu tidak valid.' });
    }

    const menu = await Menu.findById(id)
                            .populate('category', 'name')
                            .populate('ingredients.ingredientId', 'name unit'); // Populate related data

    if (!menu || menu.isDeleted === true) {
      return res.status(404).json({ message: 'Item menu tidak ditemukan atau sudah dihapus' });
    }
    res.status(200).json(menu.toJSON());
  } catch (error) {
    console.error('Error getting menu item by ID:', error);
    res.status(500).json({ message: 'Kesalahan server saat mendapatkan item menu', error: error.message });
  }
};

// @desc    Update a menu item by ID
// @route   PUT /api/v1/menus/:id
// @access  Public (in a real app, typically Private/Admin and authenticated)
export const updateMenu = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Menu tidak valid.' });
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
    if (updateData.discount !== undefined && (typeof updateData.discount !== 'number' || updateData.discount < 0 || updateData.discount > 100)) {
      errors.push('Diskon harus berupa angka antara 0 dan 100 jika disediakan.');
    }
    if (updateData.description !== undefined && typeof updateData.description !== 'string') {
        errors.push('Deskripsi harus berupa string.');
    } else if (updateData.description !== undefined) {
        updateData.description = updateData.description.trim();
    }
    if (updateData.imgUrl !== undefined && typeof updateData.imgUrl !== 'string') {
        errors.push('imgUrl harus berupa string.');
    } else if (updateData.imgUrl !== undefined) {
        updateData.imgUrl = updateData.imgUrl.trim();
    }
    if (updateData.category !== undefined) {
      if (!mongoose.Types.ObjectId.isValid(updateData.category)) {
        errors.push('ID Kategori harus berupa ObjectId yang valid jika disediakan.');
      } else {
        const existingCategory = await MenuCategory.findById(updateData.category);
        if (!existingCategory || existingCategory.isDeleted) {
          errors.push('Kategori yang disediakan tidak ada atau sudah dihapus.');
        }
      }
    }
    if (updateData.ingredients !== undefined) {
      if (!Array.isArray(updateData.ingredients)) {
        errors.push('Bahan-bahan harus berupa array jika disediakan.');
      } else {
        for (let i = 0; i < updateData.ingredients.length; i++) {
          const item = updateData.ingredients[i];
          if (!item.ingredientId || !mongoose.Types.ObjectId.isValid(item.ingredientId)) {
            errors.push(`Bahan pada indeks ${i} memiliki ingredientId yang tidak valid.`);
          } else {
            const existingIngredient = await Ingredient.findById(item.ingredientId);
            if (!existingIngredient || existingIngredient.isDeleted || !existingIngredient.isActive) {
              errors.push(`ID Bahan '${item.ingredientId}' pada indeks ${i} tidak ada, sudah dihapus, atau tidak aktif.`);
            }
          }
          if (item.qty === undefined || typeof item.qty !== 'number' || item.qty <= 0) {
            errors.push(`Kuantitas untuk bahan pada indeks ${i} diperlukan dan harus berupa angka positif.`);
          }
        }
      }
    }
    if (updateData.isActive !== undefined && typeof updateData.isActive !== 'boolean') {
      errors.push('isActive harus berupa boolean jika disediakan.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal', errors });
    }
    // --- End Controller-side Validation ---

    const menu = await Menu.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true } // runValidators to trigger schema validation
    );

    if (!menu) {
      return res.status(404).json({ message: 'Item menu tidak ditemukan' });
    }

    res.status(200).json({
      message: 'Item menu berhasil diperbarui',
      menu: menu.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Format ID Menu tidak valid.' });
    }
    if (error.code === 11000) { // Duplicate key error for 'name'
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({ message: `Item menu dengan ${field} '${value}' ini sudah ada.` });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal', errors });
    }
    console.error('Error updating menu item:', error);
    res.status(500).json({ message: 'Kesalahan server saat memperbarui item menu', error: error.message });
  }
};

// @desc    Soft delete a menu item by ID
// @route   DELETE /api/v1/menus/:id
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
      return res.status(404).json({ message: 'Item menu tidak ditemukan' });
    }

    res.status(200).json({
      message: 'Item menu berhasil dihapus secara lunak',
      menu: menu.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Format ID Menu tidak valid.' });
    }
    console.error('Error soft deleting menu item:', error);
    res.status(500).json({ message: 'Kesalahan server saat menghapus item menu secara lunak', error: error.message });
  }
};