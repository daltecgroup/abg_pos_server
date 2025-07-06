// controllers/orderController.js

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
    const { status, items } = req.body; // Destructure status and items from body
    const errors = [];

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Pesanan tidak valid.' });
    }

    let orderToUpdate = await Order.findById(id); // Fetch the current order
    if (!orderToUpdate || orderToUpdate.isDeleted) {
      return res.status(404).json({ message: 'Pesanan bahan tidak ditemukan atau sudah dihapus.' });
    }

    const userContext = req.user ? { userId: req.user._id, userName: req.user.name } : { userId: null, name: 'System' };

    // --- NEW VALIDATION: Prevent status change from ACCEPTED unless items are unaccepted ---
    if (status !== undefined && orderToUpdate.status === OrderStatuses.ACCEPTED && status !== OrderStatuses.ACCEPTED) {
        return res.status(400).json({ message: 'Semua atau salah satu item pesanan harus dibatalkan terlebih dahulu sebelum merubah status ke selain diterima.' });
    }

    // --- Handle Status Update if provided ---
    if (status !== undefined) {
      // The updateOrderStatus service handles validation and saving for the status field
      const statusUpdateResult = await orderFulfillmentService.updateOrderStatus(id, status, userContext);
      if (!statusUpdateResult.success) {
          errors.push(statusUpdateResult.message);
      }
      // After this call, the order in DB is updated with new status.
      // We will refetch the order later to get the most current state.
    }

    // --- Handle Items Update (specifically for isAccepted) if provided ---
    if (items !== undefined && Array.isArray(items)) {
        // We need to iterate through the incoming 'items' array
        // and apply changes to the existing order's items array.
        // It's crucial to ensure atomicity or proper merging.
        // The existing orderFulfillmentService.acceptOrderItem/unacceptOrderItem
        // already handles finding the item by index and updating it, and saving the order.

        // Refetch the order to ensure we have the latest state before processing item updates
        // This is important because statusUpdateResult might have changed the order in DB.
        orderToUpdate = await Order.findById(id);
        if (!orderToUpdate) { // Re-check in case it was deleted by another process
            return res.status(404).json({ message: 'Pesanan bahan tidak ditemukan setelah pembaruan status.' });
        }

        for (const updatedItemRequest of items) {
            // Find the index of the item in the order's current items array
            const itemIndex = orderToUpdate.items.findIndex(item => item.ingredientId.toString() === updatedItemRequest.ingredientId.toString());

            if (itemIndex === -1) {
                errors.push(`ID Bahan '${updatedItemRequest.ingredientId}' tidak ditemukan di pesanan asli.`);
                continue;
            }

            const existingItemInOrder = orderToUpdate.items[itemIndex];

            // Check if isAccepted is being changed to true and it was false
            if (updatedItemRequest.isAccepted === true && existingItemInOrder.isAccepted === false) {
                const acceptResult = await orderFulfillmentService.acceptOrderItem(id, itemIndex, userContext);
                if (!acceptResult.success) {
                    errors.push(acceptResult.message);
                }
                // The service call updates and saves the order.
                // We'll refetch the order again after all item updates are processed.
            }
            // Check if isAccepted is being changed to false and it was true
            else if (updatedItemRequest.isAccepted === false && existingItemInOrder.isAccepted === true) {
                // NEW LOGIC: If item is unaccepted and has an OIT, soft delete the OIT
                if (existingItemInOrder.outletInventoryTransactionId) {
                    const deleteOITResult = await outletInventoryService.softDeleteOutletInventoryTransaction(
                        existingItemInOrder.outletInventoryTransactionId,
                        userContext
                    );
                    if (!deleteOITResult.success) {
                        errors.push(`Gagal menghapus transaksi inventori outlet terkait: ${deleteOITResult.message}`);
                        // Decide if this error should block the unaccept operation. For now, it logs and continues.
                    } else {
                        console.log(`Successfully soft-deleted OIT: ${existingItemInOrder.outletInventoryTransactionId}`);
                    }
                }

                const unacceptResult = await orderFulfillmentService.unacceptOrderItem(id, itemIndex, userContext);
                if (!unacceptResult.success) {
                    errors.push(unacceptResult.message);
                }
                // The service call updates and saves the order.
                // We'll refetch the order again after all item updates are processed.
            }
            // If other fields of an item are being updated, they would need to be handled here
            // For this request, only `isAccepted` is explicitly mentioned.
        }
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal pada item pesanan atau kesalahan transaksi inventori.', errors });
    }

    // --- Final Step: Refetch the order to get its absolute latest state ---
    let finalOrder = await Order.findById(id);
    if (!finalOrder || finalOrder.isDeleted) {
        return res.status(404).json({ message: 'Pesanan bahan tidak ditemukan setelah pembaruan.' });
    }

    // --- NEW LOGIC: Check if all items are accepted and update order status ---
    if (finalOrder.items && finalOrder.items.length > 0) {
        const allItemsAccepted = finalOrder.items.every(item => item.isAccepted === true);
        let newOrderStatus = finalOrder.status; // Default to current status

        if (allItemsAccepted && finalOrder.status !== OrderStatuses.ACCEPTED) {
            newOrderStatus = OrderStatuses.ACCEPTED;
        } else if (!allItemsAccepted && finalOrder.status === OrderStatuses.ACCEPTED) {
            // If it was accepted but now an item is unaccepted, revert to PROCESSED
            newOrderStatus = OrderStatuses.PROCESSED;
        }

        // Only update if the determined new status is different from the current status
        if (newOrderStatus !== finalOrder.status) {
            const finalStatusUpdateResult = await orderFulfillmentService.updateOrderStatus(finalOrder._id, newOrderStatus, userContext);
            if (!finalStatusUpdateResult.success) {
                console.warn(`Failed to auto-update order status to ${newOrderStatus} for order ${finalOrder.code}: ${finalStatusUpdateResult.message}`);
            } else {
                // If successful, refetch to get the very latest state including the status change
                finalOrder = await Order.findById(id);
            }
        }
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
