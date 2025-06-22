import MenuCategory from '../models/MenuCategory.js';

// @desc    Create a new menu category
// @route   POST /api/v1/menucategories
// @access  Public (in a real app, typically Private/Admin and authenticated)
export const createMenuCategory = async (req, res) => {
  try {
    const { name, isActive } = req.body;

    // Controller-side validation for required fields
    if (!name || name.trim() === '') {
        return res.status(400).json({ message: 'Category name is required.' });
    }
    // isActive is boolean and has a default, so it's less critical to validate its presence
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      return res.status(400).json({ message: 'isActive must be a boolean.' });
    }

    const menuCategory = await MenuCategory.create(req.body);
    res.status(201).json({
      message: 'Menu category created successfully',
      menuCategory: menuCategory.toJSON()
    });
  } catch (error) {
    if (error.code === 11000) { // Duplicate key error for 'name'
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({ message: `Menu category with this ${field} '${value}' already exists.` });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validation failed', errors });
    }
    console.error('Error creating menu category:', error);
    res.status(500).json({ message: 'Server error creating menu category', error: error.message });
  }
};

// @desc    Get all menu categories
// @route   GET /api/v1/menucategories
// @access  Public
export const getMenuCategories = async (req, res) => {
  try {
    const filter = { isDeleted: false }; // Default: get non-deleted categories
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }
    if (req.query.name) {
      filter.name = { $regex: req.query.name, $options: 'i' }; // Case-insensitive search by name
    }

    const menuCategories = await MenuCategory.find(filter).sort({ createdAt: -1 });
    res.status(200).json(menuCategories.map(cat => cat.toJSON()));
  } catch (error) {
    console.error('Error getting menu categories:', error);
    res.status(500).json({ message: 'Server error getting menu categories', error: error.message });
  }
};

// @desc    Get a single menu category by ID
// @route   GET /api/v1/menucategories/:id
// @access  Public
export const getMenuCategoryById = async (req, res) => {
  try {
    const menuCategory = await MenuCategory.findById(req.params.id);
    if (!menuCategory || menuCategory.isDeleted === true) {
      return res.status(404).json({ message: 'Menu category not found or is deleted' });
    }
    res.status(200).json(menuCategory.toJSON());
  } catch (error) {
    console.error('Error getting menu category by ID:', error);
    res.status(500).json({ message: 'Server error getting menu category', error: error.message });
  }
};

// @desc    Update a menu category by ID
// @route   PUT /api/v1/menucategories/:id
// @access  Public (in a real app, typically Private/Admin and authenticated)
export const updateMenuCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    // Controller-side validation for update (only if fields are provided)
    if (updateData.name !== undefined && (typeof updateData.name !== 'string' || updateData.name.trim() === '')) {
      return res.status(400).json({ message: 'Category name must be a non-empty string if provided.' });
    }
    if (updateData.isActive !== undefined && typeof updateData.isActive !== 'boolean') {
      return res.status(400).json({ message: 'isActive must be a boolean if provided.' });
    }

    const menuCategory = await MenuCategory.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true } // runValidators to trigger schema validation
    );

    if (!menuCategory) {
      return res.status(404).json({ message: 'Menu category not found' });
    }

    res.status(200).json({
      message: 'Menu category updated successfully',
      menuCategory: menuCategory.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Invalid Menu Category ID format.' });
    }
    if (error.code === 11000) { // Duplicate key error for 'name'
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({ message: `Menu category with this ${field} '${value}' already exists.` });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validation failed', errors });
    }
    console.error('Error updating menu category:', error);
    res.status(500).json({ message: 'Server error updating menu category', error: error.message });
  }
};

// @desc    Soft delete a menu category by ID
// @route   DELETE /api/v1/menucategories/:id
// @access  Public (in a real app, typically Private/Admin and authenticated)
export const deleteMenuCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const menuCategory = await MenuCategory.findByIdAndUpdate(
      id,
      { isDeleted: true, deletedAt: new Date() /* , deletedBy: req.user.id */ },
      { new: true }
    );

    if (!menuCategory) {
      return res.status(404).json({ message: 'Menu category not found' });
    }

    res.status(200).json({
      message: 'Menu category soft-deleted successfully',
      menuCategory: menuCategory.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Invalid Menu Category ID format.' });
    }
    console.error('Error soft deleting menu category:', error);
    res.status(500).json({ message: 'Server error soft-deleting menu category', error: error.message });
  }
};