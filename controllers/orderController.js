import Order from '../models/Order.js';
import Outlet from '../models/Outlet.js';
import User from '../models/User.js';
import OutletInventoryTransaction from '../models/OutletInventoryTransaction.js';
import Ingredient from '../models/Ingredient.js';
import { Roles } from '../constants/roles.js';
import { TransactionTypes } from '../constants/transactionTypes.js';
import { SourceTypes } from '../constants/sourceTypes.js';
import { OrderStatuses } from '../constants/orderStatuses.js';
import mongoose from 'mongoose';

// NEW: Import the order fulfillment service
import * as orderFulfillmentService from '../services/orderFulfillmentService.js';
// NEW: Import the outlet inventory service (needed for direct invalidate call in deleteOrder if not handled by orderFulfillmentService)
import * as outletInventoryService from '../services/outletInventoryService.js';


// Helper function to validate User references (kept here as it's a general controller utility)
const validateUserReference = async (userId, errorsArray, fieldName, requiredRole = null) => {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    errorsArray.push(`ID Pengguna tidak valid untuk ${fieldName}.`);
    return null;
  }
  const user = await User.findById(userId);
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

// --- CRUD Controller Functions for Order ---

// @desc    Create a new order (for ingredients from headquarters)
// @route   POST /api/v1/orders
// @access  Private (Operator role for placing, Admin for HQ)
export const createOrder = async (req, res) => {
  try {
    const { outletId, items } = req.body;
    const errors = [];
    let calculatedTotalPrice = 0;

    // --- Validate Outlet ---
    let outletSnapshot;
    if (!outletId || !mongoose.Types.ObjectId.isValid(outletId)) {
      errors.push('ID Outlet tidak valid.');
    } else {
      const outlet = await Outlet.findById(outletId);
      if (!outlet || outlet.isDeleted || !outlet.isActive) {
        errors.push('Outlet yang disediakan tidak ditemukan, sudah dihapus, atau tidak aktif.');
      } else {
        outletSnapshot = {
          outletId: outlet._id,
          name: outlet.name,
          address: outlet.address
        };
      }
    }

    // --- Validate CreatedBy (User who placed the order - likely an Operator or Admin from an Outlet) ---
    let createdBySnapshot;
    if (!req.user || !req.user._id || !req.user.name) {
      errors.push('Informasi pengguna pembuat pesanan tidak tersedia. Pastikan pengguna terautentikasi.');
    } else {
      const user = await validateUserReference(req.user._id, errors, 'pembuat pesanan');
      if (user) {
        createdBySnapshot = { userId: user.userId, name: user.name };
      }
    }

    // --- Validate and Process Order Items (Ingredients) ---
    const processedItems = [];
    if (!items || !Array.isArray(items) || items.length === 0) {
      errors.push('Daftar item pesanan (bahan) diperlukan.');
    } else {
      for (const item of items) {
        if (!item.ingredientId || !mongoose.Types.ObjectId.isValid(item.ingredientId) || item.qty === undefined || item.qty < 1) {
          errors.push('Item pesanan memiliki format ID bahan atau jumlah yang tidak valid (minimal 1).');
          continue;
        }
        const ingredient = await Ingredient.findById(item.ingredientId);
        if (!ingredient || ingredient.isDeleted || !ingredient.isActive) {
          errors.push(`Bahan ID '${item.ingredientId}' tidak ditemukan, sudah dihapus, atau tidak aktif.`);
          continue;
        }

        processedItems.push({
          ingredientId: ingredient._id,
          name: ingredient.name,
          unit: ingredient.unit,
          qty: item.qty,
          price: ingredient.price,
          notes: item.notes || null,
          isAccepted: item.isAccepted || false,
          outletInventoryTransactionId: null,
        });
        calculatedTotalPrice += item.qty * ingredient.price;
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }

    const orderData = {
      outlet: outletSnapshot,
      items: processedItems,
      totalPrice: calculatedTotalPrice,
      createdBy: createdBySnapshot,
      status: OrderStatuses.ORDERED,
    };

    const order = await Order.create(orderData);
    res.status(201).json({
      message: 'Pesanan bahan berhasil dicatat.',
      order: order.toJSON()
    });

  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(409).json({ message: `Pesanan dengan ${field} '${value}' sudah ada.` });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    console.error('Kesalahan saat membuat pesanan bahan:', error);
    res.status(500).json({ message: 'Kesalahan server saat membuat pesanan bahan.', error: error.message });
  }
};

// @desc    Get all orders (for ingredients)
// @route   GET /api/v1/orders
// @access  Private (Admin, SPV Area, Operator for their outlet)
export const getOrders = async (req, res) => {
  try {
    const filter = { isDeleted: false };
    const { outletId, status, dateFrom, dateTo } = req.query;

    if (outletId) {
      if (!mongoose.Types.ObjectId.isValid(outletId)) {
        return res.status(400).json({ message: 'ID Outlet tidak valid untuk filter.' });
      }
      filter['outlet.outletId'] = outletId;
    }
    if (status) {
      if (!Object.values(OrderStatuses).includes(status)) {
        return res.status(400).json({ message: 'Status pesanan tidak valid untuk filter.' });
      }
      filter.status = status;
    }
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) {
        const d = new Date(dateFrom);
        if (isNaN(d.getTime())) { return res.status(400).json({ message: 'Format tanggal "dateFrom" tidak valid.' }); }
        filter.createdAt.$gte = d;
      }
      if (dateTo) {
        const d = new Date(dateTo);
        if (isNaN(d.getTime())) { return res.status(400).json({ message: 'Format tanggal "dateTo" tidak valid.' }); }
        filter.createdAt.$lte = new Date(d.getTime() + 24 * 60 * 60 * 1000 - 1);
      }
    }

    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.status(200).json(orders.map(order => order.toJSON()));
  } catch (error) {
    console.error('Kesalahan saat mengambil pesanan bahan:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengambil pesanan bahan.', error: error.message });
  }
};

// @desc    Get a single order by ID (for ingredients)
// @route   GET /api/v1/orders/:id
// @access  Private (Admin, SPV Area, Operator for their outlet)
export const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Pesanan tidak valid.' });
    }

    const order = await Order.findById(id);

    if (!order || order.isDeleted === true) {
      return res.status(404).json({ message: 'Pesanan bahan tidak ditemukan atau sudah dihapus.' });
    }
    res.status(200).json(order.toJSON());
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Format ID Pesanan tidak valid.' });
    }
    console.error('Kesalahan saat mengambil pesanan bahan berdasarkan ID:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengambil pesanan bahan berdasarkan ID.', error: error.message });
  }
};

// @desc    Update an order (e.g., status, accept items/ingredients by HQ)
// @route   PATCH /api/v1/orders/:id
// @access  Private (Admin, SPV Area for accepting items)
export const updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, items } = req.body;
    const errors = [];

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Pesanan tidak valid.' });
    }

    const existingOrder = await Order.findById(id);
    if (!existingOrder || existingOrder.isDeleted) {
      return res.status(404).json({ message: 'Pesanan bahan tidak ditemukan atau sudah dihapus.' });
    }

    let updatedFields = {};
    const userContext = req.user ? { userId: req.user._id, userName: req.user.name } : { userId: null, name: 'System' };

    // --- Handle Status Update ---
    if (status !== undefined) {
      const statusUpdateResult = await orderFulfillmentService.updateOrderStatus(id, status, userContext);
      if (!statusUpdateResult.success) {
          errors.push(statusUpdateResult.message);
      } else {
          updatedFields.status = status; // Reflect the change for the response
      }
    }

    // --- Handle Items Update (specifically for isAccepted and creating/invalidating OutletInventoryTransaction) ---
    if (items !== undefined && Array.isArray(items)) {
        const newItemsArray = existingOrder.items.map(item => item.toObject());

        for (const updatedItemRequest of items) {
            const itemIndex = newItemsArray.findIndex(item => item.ingredientId.toString() === updatedItemRequest.ingredientId.toString());

            if (itemIndex === -1) {
                errors.push(`ID Bahan '${updatedItemRequest.ingredientId}' tidak ditemukan di pesanan asli.`);
                continue;
            }

            const existingItem = newItemsArray[itemIndex];

            if (updatedItemRequest.isAccepted === true && existingItem.isAccepted === false) {
                const acceptResult = await orderFulfillmentService.acceptOrderItem(id, itemIndex, userContext);
                if (!acceptResult.success) {
                    errors.push(acceptResult.message);
                } else {
                    // Update the local representation to reflect the changes made by the service
                    existingItem.isAccepted = true;
                    existingItem.outletInventoryTransactionId = acceptResult.outletInventoryTransactionId;
                }
            }
            else if (updatedItemRequest.isAccepted === false && existingItem.isAccepted === true) {
                const unacceptResult = await orderFulfillmentService.unacceptOrderItem(id, itemIndex, userContext);
                if (!unacceptResult.success) {
                    errors.push(unacceptResult.message);
                } else {
                    // Update the local representation
                    existingItem.isAccepted = false;
                    existingItem.outletInventoryTransactionId = null;
                }
            }
        }
        updatedFields.items = newItemsArray; // Update the items array in the main update object
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal pada item pesanan atau kesalahan transaksi inventori.', errors });
    }

    // If status was handled by the service, and items were handled by the service,
    // the only thing left to update in the main order document might be nothing,
    // or other general fields that are not handled by these specific services.
    // For now, save the updated order directly if its items array was modified.
    // If only status was updated, orderFulfillmentService.updateOrderStatus already saved it.

    // If 'items' array was updated, we need to save the order document.
    // Otherwise, if only status was updated (which is handled by `updateOrderStatus` that saves the order),
    // we don't need to save again here.
    let finalOrder;
    if (updatedFields.items) {
        finalOrder = await Order.findByIdAndUpdate(
            id,
            { $set: { items: updatedFields.items, ...(updatedFields.status && { status: updatedFields.status }) } },
            { new: true, runValidators: true }
        );
    } else if (updatedFields.status) {
        // Status was updated by service, fetch latest
        finalOrder = await Order.findById(id);
    } else {
        // No specific updates required by the controller, fetch current state
        finalOrder = existingOrder;
    }


    if (!finalOrder) {
      return res.status(404).json({ message: 'Pesanan bahan tidak ditemukan setelah pembaruan.' });
    }

    res.status(200).json({
      message: 'Pesanan bahan berhasil diperbarui.',
      order: finalOrder.toJSON()
    });

  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Format ID Pesanan tidak valid.' });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    console.error('Kesalahan saat memperbarui pesanan bahan:', error);
    res.status(500).json({ message: 'Kesalahan server saat memperbarui pesanan bahan.', error: error.message });
  }
};


// @desc    Soft delete an order (Admin only)
// @route   DELETE /api/v1/orders/:id
// @access  Private (Admin role)
export const deleteOrder = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Pesanan tidak valid.' });
    }

    // Security check: Ensure only Admin can perform this soft delete
    if (!req.user || !req.user.roles || !req.user.roles.includes(Roles.admin)) {
       return res.status(403).json({ message: 'Anda tidak memiliki izin untuk menghapus pesanan bahan ini.' });
    }

    const orderToDelete = await Order.findById(id);
    if (!orderToDelete) {
        return res.status(404).json({ message: 'Pesanan bahan tidak ditemukan.' });
    }

    // Invalidate any linked OITs if the order is being soft-deleted
    const userContext = req.user ? { userId: req.user._id, userName: req.user.name } : { userId: null, name: 'System' };
    for (const item of orderToDelete.items) {
        if (item.isAccepted && item.outletInventoryTransactionId) {
            // Use the toggle function to invalidate the associated OIT
            const toggleSuccess = await outletInventoryService.toggleOutletInventoryTransactionValidation(
                item.outletInventoryTransactionId,
                false, // Set isValid to false
                userContext
            );
            if (!toggleSuccess) {
                console.warn(`Failed to invalidate linked OIT ${item.outletInventoryTransactionId} for order ${id} during soft delete.`);
                // Decide if you want to block the delete or just warn. For now, warn and proceed.
            }
        }
    }

    const order = await Order.findByIdAndUpdate(
      id,
      { isDeleted: true, deletedAt: new Date(), deletedBy: req.user._id },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ message: 'Pesanan bahan tidak ditemukan.' });
    }

    res.status(200).json({
      message: 'Pesanan bahan berhasil dihapus (soft delete).',
      order: order.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Format ID Pesanan tidak valid.' });
    }
    console.error('Kesalahan saat menghapus pesanan bahan:', error);
    res.status(500).json({ message: 'Kesalahan server saat menghapus pesanan bahan.', error: error.message });
  }
};
