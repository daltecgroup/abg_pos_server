import OutletInventory from '../models/OutletInventory.js';
import Outlet from '../models/Outlet.js';
import Ingredient from '../models/Ingredient.js';
import { Roles } from '../constants/roles.js'; // For role-based access checks
import mongoose from 'mongoose'; // For ObjectId validation

// --- Helper Functions ---
// (Reusing validateUserReference from other controllers if needed, or define here)
const validateUserReference = async (userId, errorsArray, fieldName, requiredRole = null) => {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    errorsArray.push(`ID Pengguna tidak valid untuk ${fieldName}.`);
    return null;
  }
  const user = await User.findById(userId); // Assuming User model is accessible
  if (!user || user.isDeleted || !user.isActive) {
    errorsArray.push(`Pengguna dengan ID '${userId}' untuk ${fieldName} tidak ditemukan, sudah dihapus, atau tidak aktif.`);
    return null;
  }
  if (requiredRole && !user.roles.includes(requiredRole)) {
    errorsArray.push(`Pengguna '${user.name}' (ID: '${userId}') untuk ${fieldName} bukan peran '${requiredRole}'.`);
    return null;
  }
  return { userId: user._id, name: user.name };
};

// --- CRUD Controller Functions for OutletInventory ---

// @desc    Get all outlet inventory documents
// @route   GET /api/v1/outletinventory
// @access  Private (Admin, SPV Area, Franchisee)
export const getOutletInventories = async (req, res) => {
  try {
    const filter = { isDeleted: false };
    const { outletId, ingredientId, minQty, maxQty } = req.query; // Add filters as needed

    if (outletId) {
      if (!mongoose.Types.ObjectId.isValid(outletId)) return res.status(400).json({ message: 'Format ID Outlet tidak valid untuk filter.' });
      filter._id = outletId; // Filter by the _id of the OutletInventory document (which is the outletId)
    }

    // Filter by ingredient within the nested array
    if (ingredientId) {
      if (!mongoose.Types.ObjectId.isValid(ingredientId)) return res.status(400).json({ message: 'Format ID Bahan tidak valid untuk filter.' });
      filter['ingredients.ingredientId'] = ingredientId;
    }

    // Filter by quantity range for a specific ingredient (more complex, might require aggregation)
    // For simplicity, this initial implementation won't support min/maxQty across all ingredients,
    // but you could build an aggregation pipeline if needed.
    // E.g., to find outlets with less than X of a *specific* ingredient:
    // filter['ingredients'] = { $elemMatch: { ingredientId: 'someId', currentQty: { $lt: minQty } } };

    const outletInventories = await OutletInventory.find(filter)
      .sort({ createdAt: -1 });

    res.status(200).json(outletInventories.map(inv => inv.toJSON()));
  } catch (error) {
    console.error('Error getting outlet inventories:', error);
    res.status(500).json({ message: 'Server error getting outlet inventories.', error: error.message });
  }
};

// @desc    Get a single outlet inventory by its _id (which is the outletId)
// @route   GET /api/v1/outletinventory/:id
// @access  Private (Admin, SPV Area, Franchisee/Operator for their own outlet)
export const getOutletInventoryById = async (req, res) => {
  try {
    const { id } = req.params; // 'id' here is the outletId that serves as _id for OutletInventory
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Inventori Outlet tidak valid.' });
    }

    const outletInventory = await OutletInventory.findById(id);

    if (!outletInventory || outletInventory.isDeleted === true) {
      return res.status(404).json({ message: 'Inventori Outlet tidak ditemukan atau sudah dihapus.' });
    }

    if(req.user && req.user.roles.includes(Roles.admin)){
      return res.status(200).json(outletInventory.toJSON());
    }

    // Security check: If operator/franchisee, ensure they can only view their own outlet's inventory
    if (req.user && (req.user.roles.includes(Roles.operator) || req.user.roles.includes(Roles.franchisee))) {
      // Find the outlets associated with this user
      const userOutlets = await Outlet.find({
        $or: [{ operators: req.user._id }, { franchisees: req.user._id }],
        isDeleted: false
      }).select('_id');
      const userOutletIds = userOutlets.map(outlet => outlet._id.toString());

      if (!userOutletIds.includes(outletInventory._id.toString())) {
        return res.status(403).json({ message: 'Anda tidak diizinkan untuk melihat inventori outlet ini.' });
      }
    }


    res.status(200).json(outletInventory.toJSON());
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Format ID Inventori Outlet tidak valid.' });
    }
    console.error('Error getting outlet inventory by ID:', error);
    res.status(500).json({ message: 'Server error getting outlet inventory.', error: error.message });
  }
};

// @desc    Get a single outlet inventory by its outletId (alternative route for clarity)
// @route   GET /api/v1/outletinventory/byoutlet/:outletId
// @access  Private (Admin, SPV Area, Franchisee/Operator for their own outlet)
export const getOutletInventoryByOutletId = async (req, res) => {
  // This is essentially the same as getOutletInventoryById, just with a clearer route name.
  // Re-use the existing logic.
  req.params.id = req.params.outletId; // Map outletId from path to 'id' for getOutletInventoryById
  return getOutletInventoryById(req, res);
};

// @desc    Update an outlet inventory (e.g., adjust reorder levels, isActive status)
//          Note: `currentQty` should primarily be updated via OutletInventoryTransactions,
//          not directly through this endpoint to maintain data integrity from transactions.
// @route   PATCH /api/v1/outletinventory/:id
// @access  Private (Admin, SPV Area)
export const updateOutletInventory = async (req, res) => {
  try {
    const { id } = req.params; // 'id' here is the outletId
    const updateData = { ...req.body };
    const errors = [];

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Inventori Outlet tidak valid.' });
    }

    const existingInventory = await OutletInventory.findById(id);
    if (!existingInventory || existingInventory.isDeleted) {
      return res.status(404).json({ message: 'Inventori Outlet tidak ditemukan atau sudah dihapus.' });
    }

    // Prevent direct update of the ingredients array's currentQty here.
    // Only allow updates to metadata or specific ingredient thresholds if you add them to the schema.
    if (updateData.ingredients !== undefined) {
      // You could allow updating reorderLevel/maxStockLevel for individual ingredients here.
      // But disallow direct `currentQty` manipulation.
      // Example:
      // for (const updatedIng of updateData.ingredients) {
      //   if (updatedIng.currentQty !== undefined) {
      //     errors.push('Jumlah saat ini (currentQty) bahan tidak dapat diperbarui langsung melalui endpoint ini. Gunakan transaksi inventori.');
      //     break;
      //   }
      //   // Add validation/logic for reorderLevel, maxStockLevel etc.
      // }
      errors.push('Array bahan tidak dapat diperbarui langsung melalui endpoint ini. Gunakan transaksi inventori atau endpoint yang ditentukan untuk ambang batas reorder.');
    }

    // Example of allowing updates to general inventory document fields (if added to schema)
    // if (updateData.isActive !== undefined && typeof updateData.isActive !== 'boolean') {
    //    errors.push('isActive harus berupa boolean.');
    // }

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }

    const updatedInventory = await OutletInventory.findByIdAndUpdate(
      id,
      { $set: updateData }, // Use $set to update specific fields, preserving others
      { new: true, runValidators: true }
    );

    res.status(200).json({
      message: 'Inventori Outlet berhasil diperbarui.',
      outletInventory: updatedInventory.toJSON(),
    });

  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Format ID Inventori Outlet tidak valid.' });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    console.error('Error updating outlet inventory:', error);
    res.status(500).json({ message: 'Server error updating outlet inventory.', error: error.message });
  }
};

// @desc    Soft delete an outlet inventory document (typically triggered when an outlet is soft-deleted)
// @route   DELETE /api/v1/outletinventory/:id
// @access  Private (Admin role)
export const deleteOutletInventory = async (req, res) => {
  try {
    const { id } = req.params; // 'id' here is the outletId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Inventori Outlet tidak valid.' });
    }

    // Security check: Only Admin can perform this soft delete
    if (!req.user || !req.user.roles || !req.user.roles.includes(Roles.admin)) {
      return res.status(403).json({ message: 'Anda tidak memiliki izin untuk menghapus inventori outlet ini.' });
    }

    const outletInventory = await OutletInventory.findByIdAndUpdate(
      id,
      { isDeleted: true, deletedAt: new Date(), deletedBy: req.user._id },
      { new: true }
    );

    if (!outletInventory) {
      return res.status(404).json({ message: 'Inventori Outlet tidak ditemukan.' });
    }

    res.status(200).json({
      message: 'Inventori Outlet berhasil dihapus (soft delete).',
      outletInventory: outletInventory.toJSON(),
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Format ID Inventori Outlet tidak valid.' });
    }
    console.error('Error soft deleting outlet inventory:', error);
    res.status(500).json({ message: 'Server error soft-deleting outlet inventory.', error: error.message });
  }
};
