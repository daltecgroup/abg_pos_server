import Addon from '../models/Addon.js'; // Import the Addon model
import Ingredient from '../models/Ingredient.js'; // Import for ingredient validation
import mongoose from 'mongoose'; // For ObjectId validation

// @desc    Create a new addon
// @route   POST /api/v1/addons
// @access  Private/Admin
export const createAddon = async (req, res) => {
  try {
    const { name, price, ingredients, imgUrl, isActive } = req.body;

    // --- Controller-side Validation for Create ---
    const errors = [];

    if (!name || name.trim() === '') {
      errors.push('Nama wajib diisi.');
    }
    if (price === undefined || typeof price !== 'number' || price < 0) {
      errors.push('Harga wajib diisi dan harus berupa angka non-negatif.');
    }
    if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
      errors.push('Bahan-bahan wajib diisi dan harus berupa array dengan setidaknya satu item.');
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
          errors.push(`Kuantitas untuk bahan pada indeks ${i} wajib diisi dan harus berupa angka positif.`);
        }
      }
    }
    if (imgUrl !== undefined && typeof imgUrl !== 'string') {
        errors.push('imgUrl harus berupa string jika disediakan.');
    } else if (imgUrl !== undefined) {
        req.body.imgUrl = imgUrl.trim(); // Trim imgUrl if provided
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      errors.push('isActive harus berupa boolean jika disediakan.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal', errors });
    }
    // --- End Controller-side Validation ---

    // Trim name before creating
    req.body.name = req.body.name.trim();

    const addon = await Addon.create(req.body); // Code will be set by pre-save hook
    res.status(201).json({
      message: 'Addon berhasil dibuat',
      addon: addon.toJSON()
    });
  } catch (error) {
    if (error.code === 11000) { // Duplicate key error for 'name'
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({ message: `Addon dengan ${field} '${value}' ini sudah ada.` });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal', errors });
    }
    console.error('Error creating addon:', error);
    res.status(500).json({ message: 'Kesalahan server saat membuat addon', error: error.message });
  }
};

// @desc    Get all addons
// @route   GET /api/v1/addons
// @access  Public
export const getAddons = async (req, res) => {
  try {
    const filter = { isDeleted: false }; // Default: get non-deleted addons
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

    // Populate ingredients if requested or always
    const populateFields = req.query.populate;
    if (populateFields && populateFields.includes('ingredients')) {
      query.populate('ingredients.ingredientId', 'name unit'); // Only fetch 'name' and 'unit' of ingredient
    } else {
        // Default to populate ingredients if no populate param
        query.populate('ingredients.ingredientId', 'name unit');
    }

    const addons = await query.exec();
    res.status(200).json(addons.map(addon => addon.toJSON()));
  } catch (error) {
    console.error('Error getting addons:', error);
    res.status(500).json({ message: 'Kesalahan server saat mendapatkan addon', error: error.message });
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
                              .populate('ingredients.ingredientId', 'name unit'); // Populate ingredients

    if (!addon || addon.isDeleted === true) {
      return res.status(404).json({ message: 'Addon tidak ditemukan atau sudah dihapus' });
    }
    res.status(200).json(addon.toJSON());
  } catch (error) {
    console.error('Error getting addon by ID:', error);
    res.status(500).json({ message: 'Kesalahan server saat mendapatkan addon', error: error.message });
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
            errors.push(`Kuantitas untuk bahan pada indeks ${i} wajib diisi dan harus berupa angka positif.`);
          }
        }
      }
    }
    if (updateData.imgUrl !== undefined && typeof updateData.imgUrl !== 'string') {
        errors.push('imgUrl harus berupa string.');
    } else if (updateData.imgUrl !== undefined) {
        updateData.imgUrl = updateData.imgUrl.trim();
    }
    if (updateData.isActive !== undefined && typeof updateData.isActive !== 'boolean') {
      errors.push('isActive harus berupa boolean jika disediakan.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal', errors });
    }
    // --- End Controller-side Validation ---

    const addon = await Addon.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true } // runValidators to trigger schema validation
    );

    if (!addon) {
      return res.status(404).json({ message: 'Addon tidak ditemukan' });
    }

    res.status(200).json({
      message: 'Addon berhasil diperbarui',
      addon: addon.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Format ID Addon tidak valid.' });
    }
    if (error.code === 11000) { // Duplicate key error for 'name'
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({ message: `Addon dengan ${field} '${value}' ini sudah ada.` });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal', errors });
    }
    console.error('Error updating addon:', error);
    res.status(500).json({ message: 'Kesalahan server saat memperbarui addon', error: error.message });
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
      return res.status(404).json({ message: 'Addon tidak ditemukan' });
    }

    res.status(200).json({
      message: 'Addon berhasil dihapus secara lunak',
      addon: addon.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Format ID Addon tidak valid.' });
    }
    console.error('Error soft deleting addon:', error);
    res.status(500).json({ message: 'Kesalahan server saat menghapus addon secara lunak', error: error.message });
  }
};