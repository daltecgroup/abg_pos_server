// controllers/orderController.js

import Order from '../models/Order.js'; // Import the Order model
import Outlet from '../models/Outlet.js'; // For outlet details embedding
import Ingredient from '../models/Ingredient.js'; // For ingredient details embedding
import User from '../models/User.js'; // For createdBy user validation
import mongoose from 'mongoose'; // For ObjectId validation
import { OrderStatuses } from '../constants/orderStatuses.js'; // NEW: Import OrderStatuses enum

// Helper function for common validation for user references
const validateUserReference = async (userId, errorsArray, fieldName) => {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    errorsArray.push(`ID Pengguna tidak valid untuk ${fieldName}.`);
    return null;
  }
  const user = await User.findById(userId);
  if (!user || user.isDeleted || !user.isActive) { // Assuming user needs to be active and not deleted
    errorsArray.push(`Pengguna dengan ID '${userId}' untuk ${fieldName} tidak ditemukan, sudah dihapus, atau tidak aktif.`);
    return null;
  }
  return { userId: user._id, userName: user.name };
};

// @desc    Create a new order
// @route   POST /api/orders
// @access  Public (in a real app, typically Private/Authenticated)
export const createOrder = async (req, res) => {
  try {
    const { outletId, items, status } = req.body; // createdBy is now implicitly from req.user
    let totalOrderPrice = 0;
    const errors = [];
    const processedItems = []; // To store validated and enriched items

    // --- Validate Outlet ---
    if (!outletId || !mongoose.Types.ObjectId.isValid(outletId)) {
      errors.push('ID Outlet tidak valid.');
    } else {
      const outlet = await Outlet.findById(outletId);
      if (!outlet || outlet.isDeleted || !outlet.isActive) {
        errors.push('Outlet yang disediakan tidak ditemukan, sudah dihapus, atau tidak aktif.');
      } else {
        // Embed outlet details
        req.body.outlet = {
          outletId: outlet._id,
          name: outlet.name,
          address: outlet.address // Embed entire address subdocument
        };
      }
    }

    // --- Populate CreatedBy User from req.user (assuming authentication middleware) ---
    if (!req.user || !req.user._id) { // Assuming req.user exists and has _id
      errors.push('Informasi pengguna pembuat tidak tersedia. Pastikan pengguna terautentikasi.');
    } else {
      req.body.createdBy = {
        userId: req.user._id, // Use _id directly from the authenticated user object
        userName: req.user.name || 'Pengguna Tidak Dikenal' // Use user's name, fallback if not available
      };
    }

    // --- Validate Order Items ---
    if (!items || !Array.isArray(items) || items.length === 0) {
      errors.push('Setidaknya satu item pesanan diperlukan.');
    } else {
      for (const item of items) {
        if (!item.ingredientId || !mongoose.Types.ObjectId.isValid(item.ingredientId)) {
          errors.push(`Item pesanan memiliki ID bahan tidak valid: '${item.ingredientId}'.`);
          continue;
        }
        if (item.qty === undefined || typeof item.qty !== 'number' || item.qty <= 0) {
          errors.push(`Jumlah bahan '${item.ingredientId}' harus berupa angka positif.`);
          continue;
        }

        const ingredient = await Ingredient.findById(item.ingredientId);
        if (!ingredient || ingredient.isDeleted || !ingredient.isActive) {
          errors.push(`Bahan dengan ID '${item.ingredientId}' tidak ditemukan, sudah dihapus, atau tidak aktif.`);
          continue;
        }

        // Embed ingredient details at the time of order
        processedItems.push({
          ingredientId: ingredient._id,
          name: ingredient.name,
          qty: item.qty,
          price: ingredient.price, // Use ingredient's current price
          unit: ingredient.unit,   // Use ingredient's current unit
          isAccepted: item.isAccepted !== undefined ? item.isAccepted : false // Use provided or default to false
        });
        totalOrderPrice += item.qty * ingredient.price;
      }
      req.body.items = processedItems; // Replace with processed items
      req.body.total = totalOrderPrice; // Set calculated total
    }

    // --- Validate Status (optional on create, will default to 'ordered') ---
    if (status !== undefined && !Object.values(OrderStatuses).includes(status)) { // MODIFIED: Use OrderStatuses enum
      errors.push('Status pesanan tidak valid.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    // --- End Controller-side Validation ---

    const order = await Order.create(req.body); // Schema pre-save hook will generate code
    res.status(201).json({
      message: 'Pesanan berhasil dibuat.',
      order: order.toJSON()
    });
  } catch (error) {
    if (error.code === 11000) { // Duplicate key error (e.g., from code uniqueness, though less likely with daily reset)
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({ message: `Pesanan dengan ${field} '${value}' sudah ada.` });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    console.error('Kesalahan saat membuat pesanan:', error);
    res.status(500).json({ message: 'Kesalahan server saat membuat pesanan.', error: error.message });
  }
};

// @desc    Get all orders
// @route   GET /api/orders
// @access  Public (in a real app, typically Private/Authenticated)
export const getOrders = async (req, res) => {
  try {
    const filter = { isDeleted: false }; // Default: get non-deleted orders
    // Filtering by status
    if (req.query.status) {
      if (!Object.values(OrderStatuses).includes(req.query.status)) { // MODIFIED: Use OrderStatuses enum
        return res.status(400).json({ message: 'Status pesanan tidak valid untuk filter.' });
      }
      filter.status = req.query.status;
    }
    // Filtering by outletId
    if (req.query.outletId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.outletId)) {
        return res.status(400).json({ message: 'ID Outlet tidak valid untuk filter.' });
      }
      filter['outlet.outletId'] = req.query.outletId; // Filter by embedded outletId
    }
    // Filtering by createdBy.userId
    if (req.query.createdByUserId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.createdByUserId)) {
        return res.status(400).json({ message: 'ID Pengguna pembuat tidak valid untuk filter.' });
      }
      filter['createdBy.userId'] = req.query.createdByUserId; // Filter by embedded createdBy userId
    }
    // Filtering by code
    if (req.query.code) {
      filter.code = { $regex: req.query.code, $options: 'i' };
    }

    const query = Order.find(filter).sort({ createdAt: -1 }); // Sort by newest first

    // Populate createdBy user and original Ingredient (optional)
    const populateFields = req.query.populate;
    if (populateFields) {
      if (populateFields.includes('createdBy')) query.populate('createdBy.userId', 'name userId');
      if (populateFields.includes('items.ingredient')) query.populate('items.ingredientId', 'name unit price'); // Populate original ingredient if needed
    } else {
        // Default populate commonly needed fields
        query.populate('createdBy.userId', 'name userId');
    }

    const orders = await query.exec();
    res.status(200).json(orders.map(order => order.toJSON()));
  } catch (error) {
    console.error('Kesalahan saat mengambil pesanan:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengambil pesanan.', error: error.message });
  }
};

// @desc    Get a single order by ID
// @route   GET /api/orders/:id
// @access  Public (in a real app, typically Private/Authenticated)
export const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Pesanan tidak valid.' });
    }

    const order = await Order.findById(id)
                          .populate('createdBy.userId', 'name userId')
                          .populate('items.ingredientId', 'name unit price'); // Populate original ingredient

    if (!order || order.isDeleted === true) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan atau sudah dihapus.' });
    }
    res.status(200).json(order.toJSON());
  } catch (error) {
    console.error('Kesalahan saat mengambil pesanan berdasarkan ID:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengambil pesanan.', error: error.message });
  }
};

// @desc    Update an order by ID (e.g., change status, update item acceptance)
// @route   PUT /api/orders/:id
// @access  Public (in a real app, typically Private/Admin or by assigned roles)
export const updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    const errors = [];

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Pesanan tidak valid.' });
    }

    const existingOrder = await Order.findById(id);
    if (!existingOrder || existingOrder.isDeleted) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan atau sudah dihapus.' });
    }

    // --- Controller-side Validation for Update ---
    // Status update validation
    if (updateData.status !== undefined) {
      // MODIFIED: Use OrderStatuses enum
      if (!Object.values(OrderStatuses).includes(updateData.status)) {
        errors.push('Status pesanan tidak valid.');
      }
      // Add status transition logic if needed (e.g., cannot go from 'accepted' to 'ordered')
      // Example: if (existingOrder.status === OrderStatuses.ACCEPTED && updateData.status !== OrderStatuses.RETURNED) { errors.push('Tidak dapat mengubah status pesanan yang sudah diterima kecuali ke "returned".'); }
    }

    // Items update validation and recalculation
    if (updateData.items !== undefined) {
      if (!Array.isArray(updateData.items)) {
        errors.push('Item pesanan harus berupa array.');
      } else {
        let newTotal = 0;
        const updatedItemsArray = [];
        for (const item of updateData.items) {
          if (!item.ingredientId || !mongoose.Types.ObjectId.isValid(item.ingredientId)) {
            errors.push(`Item pesanan memiliki ID bahan tidak valid: '${item.ingredientId}'.`);
            continue;
          }
          if (item.qty === undefined || typeof item.qty !== 'number' || item.qty <= 0) {
            errors.push(`Jumlah bahan '${item.ingredientId}' harus berupa angka positif.`);
            continue;
          }
          // For updates, we usually don't refetch price/unit unless explicitly intended.
          // We use the existing price/unit from the original order item unless explicitly changed.
          const originalItem = existingOrder.items.find(i => i.ingredientId.toString() === item.ingredientId.toString());

          // If updating an existing item or adding a new one with full details
          const itemPrice = (item.price !== undefined && typeof item.price === 'number' && item.price >= 0) ? item.price : (originalItem ? originalItem.price : 0);
          const itemUnit = (item.unit !== undefined && typeof item.unit === 'string') ? item.unit : (originalItem ? originalItem.unit : 'unknown');
          const itemName = (item.name !== undefined && typeof item.name === 'string') ? item.name : (originalItem ? originalItem.name : 'unknown');


          updatedItemsArray.push({
            ingredientId: item.ingredientId,
            name: itemName.trim(),
            qty: item.qty,
            price: itemPrice,
            unit: itemUnit.trim(),
            isAccepted: item.isAccepted !== undefined ? item.isAccepted : (originalItem ? originalItem.isAccepted : false)
          });
          newTotal += item.qty * itemPrice;
        }
        updateData.items = updatedItemsArray;
        updateData.total = newTotal;
      }
    }

    // If total is provided explicitly in updateData, it will override calculated total
    // But it's usually better to always calculate based on items for consistency.
    if (updateData.total !== undefined && typeof updateData.total !== 'number' || updateData.total < 0) {
      errors.push('Total harga harus berupa angka non-negatif.');
    }


    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    // --- End Controller-side Validation ---

    const order = await Order.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true } // runValidators to trigger schema validation (e.g., enum on status)
    );

    if (!order) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan.' });
    }

    res.status(200).json({
      message: 'Pesanan berhasil diperbarui.',
      order: order.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Format ID Pesanan tidak valid.' });
    }
    if (error.code === 11000) { // Duplicate key error for 'code'
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({ message: `Pesanan dengan ${field} '${value}' sudah ada.` });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    console.error('Kesalahan saat memperbarui pesanan:', error);
    res.status(500).json({ message: 'Kesalahan server saat memperbarui pesanan.', error: error.message });
  }
};

// @desc    Soft delete an order by ID
// @route   DELETE /api/orders/:id
// @access  Public (in a real app, typically Private/Admin)
export const deleteOrder = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Pesanan tidak valid.' });
    }

    const order = await Order.findByIdAndUpdate(
      id,
      { isDeleted: true, deletedAt: new Date() /* , deletedBy: req.user.id */ },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan.' });
    }

    res.status(200).json({
      message: 'Pesanan berhasil dihapus (soft delete).',
      order: order.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Format ID Pesanan tidak valid.' });
    }
    console.error('Kesalahan saat menghapus pesanan:', error);
    res.status(500).json({ message: 'Kesalahan server saat menghapus pesanan.', error: error.message });
  }
};

// @desc    Get orders for one or more outlets by their IDs
// @route   GET /api/orders/by-outlets
// @access  Public (in a real app, typically Private/Authenticated/Role-based)
export const getOrdersByOutlets = async (req, res) => {
  try {
    const { outletIds } = req.query; // Expecting outletIds as a comma-separated string or array

    if (!outletIds) {
      return res.status(400).json({ message: 'Parameter "outletIds" diperlukan (berupa satu ID atau daftar ID yang dipisahkan koma).' });
    }

    let outletIdList = [];
    if (Array.isArray(outletIds)) {
      outletIdList = outletIds;
    } else {
      outletIdList = outletIds.split(','); // Split by comma if it's a string
    }

    // Validate each ID in the list
    const invalidIds = outletIdList.filter(id => !mongoose.Types.ObjectId.isValid(id.trim()));
    if (invalidIds.length > 0) {
      return res.status(400).json({ message: `Format ID Outlet tidak valid: ${invalidIds.join(', ')}.` });
    }

    const filter = {
      isDeleted: false,
      'outlet.outletId': { $in: outletIdList.map(id => id.trim()) } // Filter by embedded outletId using $in
    };

    // Add optional query parameters from req.query (status, createdByUserId, code)
    if (req.query.status) {
      if (!Object.values(OrderStatuses).includes(req.query.status)) { // MODIFIED: Use OrderStatuses enum
        return res.status(400).json({ message: 'Status pesanan tidak valid untuk filter.' });
      }
      filter.status = req.query.status;
    }
    if (req.query.createdByUserId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.createdByUserId)) {
        return res.status(400).json({ message: 'ID Pengguna pembuat tidak valid untuk filter.' });
      }
      filter['createdBy.userId'] = req.query.createdByUserId;
    }
    if (req.query.code) {
      filter.code = { $regex: req.query.code, $options: 'i' };
    }

    const query = Order.find(filter).sort({ createdAt: -1 });

    query.populate('createdBy.userId', 'name userId');
    // You might also populate 'items.ingredientId' here if you want full details
    // query.populate('items.ingredientId', 'name unit price');

    const orders = await query.exec();
    res.status(200).json(orders.map(order => order.toJSON()));

  } catch (error) {
    console.error('Kesalahan saat mengambil pesanan berdasarkan daftar Outlet ID:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengambil pesanan berdasarkan daftar Outlet ID.', error: error.message });
  }
};

// @desc    Update 'isAccepted' status of a specific item within an order
// @route   PATCH /api/v1/orders/:orderId/items/:ingredientId/acceptance
// @access  Public (in a real app, typically Private/Admin or by assigned roles)
export const updateOrderItemAcceptance = async (req, res) => {
  try {
    const { orderId, ingredientId } = req.params;
    const { isAccepted } = req.body; // Expecting { "isAccepted": true/false }

    // --- Validation ---
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: 'Format ID Pesanan tidak valid.' });
    }
    if (!mongoose.Types.ObjectId.isValid(ingredientId)) {
      return res.status(400).json({ message: 'Format ID Bahan tidak valid.' });
    }
    if (typeof isAccepted !== 'boolean') {
      return res.status(400).json({ message: 'Nilai "isAccepted" harus berupa boolean (true/false).' });
    }

    const order = await Order.findById(orderId);

    if (!order || order.isDeleted) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan atau sudah dihapus.' });
    }

    // Find the item within the order's items array
    const itemToUpdate = order.items.find(item => item.ingredientId.toString() === ingredientId);

    if (!itemToUpdate) {
      return res.status(404).json({ message: `Bahan dengan ID '${ingredientId}' tidak ditemukan dalam pesanan ini.` });
    }

    // Update the isAccepted status
    itemToUpdate.isAccepted = isAccepted;

    // Save the modified order document
    await order.save({ validateBeforeSave: false }); // Skip full schema validation if only updating subdocument field

    res.status(200).json({
      message: `Status penerimaan bahan '${itemToUpdate.name}' berhasil diperbarui menjadi ${isAccepted}.`,
      order: order.toJSON()
    });

  } catch (error) {
    if (error.name === 'CastError') { // Catch invalid ID formats from Mongoose
      return res.status(400).json({ message: 'Format ID tidak valid (Pesanan atau Bahan).' });
    }
    console.error('Kesalahan saat memperbarui status penerimaan item pesanan:', error);
    res.status(500).json({ message: 'Kesalahan server saat memperbarui status penerimaan item pesanan.', error: error.message });
  }
};

