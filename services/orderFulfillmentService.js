import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Ingredient from '../models/Ingredient.js';
import OutletInventoryTransaction from '../models/OutletInventoryTransaction.js';
import { TransactionTypes } from '../constants/transactionTypes.js';
import { SourceTypes } from '../constants/sourceTypes.js';
import { OrderStatuses } from '../constants/orderStatuses.js';
import * as outletInventoryService from './outletInventoryService.js'; // Import the OIT service

/**
 * Accepts a specific item within an Order, creates an OutletInventoryTransaction (IN type),
 * and syncs it with the OutletInventory.
 * @param {string} orderId - The ID of the order.
 * @param {number} itemIndex - The index of the item within the order's items array.
 * @param {object} userContext - The user who initiated the action (e.g., { userId: ..., userName: ... }).
 * @returns {Promise<{ success: boolean, message?: string, outletInventoryTransactionId?: string }>} Result of the operation.
 */
export const acceptOrderItem = async (orderId, itemIndex, userContext) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
            return { success: false, message: 'ID Pesanan tidak valid.' };
        }

        const order = await Order.findById(orderId);
        if (!order || order.isDeleted) {
            return { success: false, message: 'Pesanan tidak ditemukan atau sudah dihapus.' };
        }

        if (itemIndex < 0 || itemIndex >= order.items.length) {
            return { success: false, message: 'Indeks item pesanan tidak valid.' };
        }

        const existingItem = order.items[itemIndex];
        if (existingItem.isAccepted) {
            return { success: false, message: `Bahan '${existingItem.name}' di pesanan sudah diterima.` };
        }

        // Fetch the Ingredient details to get its current name, unit, and price
        const ingredientDoc = await Ingredient.findById(existingItem.ingredientId);
        if (!ingredientDoc || ingredientDoc.isDeleted || !ingredientDoc.isActive) {
            return { success: false, message: `Bahan '${existingItem.name}' (ID: '${existingItem.ingredientId}') tidak ditemukan, sudah dihapus, atau tidak aktif saat mencoba membuat transaksi inventori.` };
        }

        // Create OutletInventoryTransaction
        const newTransaction = await OutletInventoryTransaction.create({
            ingredient: {
                ingredientId: ingredientDoc._id,
                name: ingredientDoc.name,
                unit: ingredientDoc.unit,
            },
            price: ingredientDoc.price, // Snapshot current price of the ingredient
            outlet: {
                outletId: order.outlet.outletId,
                name: order.outlet.name,
                address: order.outlet.address,
            },
            source: {
                sourceType: SourceTypes.ORDER,
                ref: order.code,
            },
            transactionType: TransactionTypes.IN, // Ingredients coming IN to outlet inventory
            qty: existingItem.qty, // Quantity from the order item
            notes: `Penerimaan bahan ${ingredientDoc.name} dari pesanan HQ (${order.code}).`,
            createdBy: {
                userId: userContext.userId,
                name: userContext.userName
            },
            evidenceUrl: null, // No direct evidence for auto-generated transactions from order acceptance
            isValid: true, // Auto-validated by order acceptance
            isCalculated: false, // Will be marked true by the service call below
        });

        // Call service to sync OutletInventory for this IN transaction
        const syncSuccess = await outletInventoryService.syncOutletInventory(
            newTransaction,
            userContext
        );

        if (!syncSuccess) {
            // If sync fails, consider rolling back the transaction creation.
            // For now, we'll log and proceed, relying on periodic sync to fix.
            console.error(`Failed to immediately sync OutletInventory for new transaction ${newTransaction._id}.`);
            return { success: false, message: `Transaksi inventori berhasil dibuat tetapi gagal disinkronkan dengan inventori outlet. (ID: ${newTransaction._id})` };
        }

        // Update the order item with the new transaction ID and set isAccepted to true
        existingItem.isAccepted = true;
        existingItem.outletInventoryTransactionId = newTransaction._id;
        await order.save(); // Save the updated order document

        return { success: true, message: `Bahan '${existingItem.name}' berhasil diterima.`, outletInventoryTransactionId: newTransaction._id };

    } catch (error) {
        console.error(`Error accepting order item for order ${orderId} index ${itemIndex}:`, error);
        return { success: false, message: `Kesalahan server saat menerima bahan pesanan: ${error.message}` };
    }
};

/**
 * Unaccepts a specific item within an Order, invalidating its associated OutletInventoryTransaction.
 * @param {string} orderId - The ID of the order.
 * @param {number} itemIndex - The index of the item within the order's items array.
 * @param {object} userContext - The user who initiated the action.
 * @returns {Promise<{ success: boolean, message?: string }>} Result of the operation.
 */
export const unacceptOrderItem = async (orderId, itemIndex, userContext) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
            return { success: false, message: 'ID Pesanan tidak valid.' };
        }

        const order = await Order.findById(orderId);
        if (!order || order.isDeleted) {
            return { success: false, message: 'Pesanan tidak ditemukan atau sudah dihapus.' };
        }

        if (itemIndex < 0 || itemIndex >= order.items.length) {
            return { success: false, message: 'Indeks item pesanan tidak valid.' };
        }

        const existingItem = order.items[itemIndex];
        if (!existingItem.isAccepted) {
            return { success: false, message: `Bahan '${existingItem.name}' di pesanan belum diterima.` };
        }

        if (existingItem.outletInventoryTransactionId) {
            const toggleSuccess = await outletInventoryService.toggleOutletInventoryTransactionValidation(
                existingItem.outletInventoryTransactionId,
                false, // Set isValid to false
                userContext
            );

            if (!toggleSuccess) {
                return { success: false, message: `Gagal membatalkan transaksi inventori terkait (ID: ${existingItem.outletInventoryTransactionId}).` };
            }
        }

        // Clear the link in the order item and set isAccepted to false
        existingItem.isAccepted = false;
        existingItem.outletInventoryTransactionId = null;
        await order.save(); // Save the updated order document

        return { success: true, message: `Bahan '${existingItem.name}' berhasil dibatalkan penerimaannya.` };

    } catch (error) {
        console.error(`Error unaccepting order item for order ${orderId} index ${itemIndex}:`, error);
        return { success: false, message: `Kesalahan server saat membatalkan penerimaan bahan pesanan: ${error.message}` };
    }
};

/**
 * Updates the status of an Order.
 * @param {string} orderId - The ID of the order.
 * @param {string} newStatus - The new status for the order (must be one of OrderStatuses).
 * @param {object} userContext - The user who initiated the action.
 * @returns {Promise<{ success: boolean, message?: string, order?: object }>} Result of the operation.
 */
export const updateOrderStatus = async (orderId, newStatus, userContext) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
            return { success: false, message: 'ID Pesanan tidak valid.' };
        }
        if (!Object.values(OrderStatuses).includes(newStatus)) {
            return { success: false, message: 'Status pesanan baru tidak valid.' };
        }

        const order = await Order.findById(orderId);
        if (!order || order.isDeleted) {
            return { success: false, message: 'Pesanan tidak ditemukan atau sudah dihapus.' };
        }

        order.status = newStatus;
        // Optionally, add a history log for status changes if needed, similar to Ingredient history
        await order.save();

        return { success: true, message: `Status pesanan berhasil diperbarui menjadi '${newStatus}'.`, order: order.toJSON() };

    } catch (error) {
        console.error(`Error updating order status for order ${orderId}:`, error);
        return { success: false, message: `Kesalahan server saat memperbarui status pesanan: ${error.message}` };
    }
};
