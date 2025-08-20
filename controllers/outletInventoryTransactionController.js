// controllers/outletInventoryTransactionController.js

import OutletInventoryTransaction from '../models/OutletInventoryTransaction.js';
import Outlet from '../models/Outlet.js';
import Ingredient from '../models/Ingredient.js';
import User from '../models/User.js';
import { TransactionTypes } from '../constants/transactionTypes.js';
import { SourceTypes } from '../constants/sourceTypes.js';
import { Roles } from '../constants/roles.js';
import mongoose from 'mongoose';
import multer from 'multer'; // For Multer error handling
import fs from 'fs/promises'; // For file system operations

// NEW: Import the new service layer
import * as outletInventoryService from '../services/outletInventoryService.js';
// NEW: Import UserOutlet model
import UserOutlet from '../models/UserOutlet.js';
import { fail } from 'assert';


// --- Helper Functions ---

// Helper to validate User references
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

// Helper for evidence URL
const getEvidenceUrl = (file, uploadDirectory) => {
    if (file) {
        return `/${uploadDirectory}/${file.filename}`;
    }
    return null;
};

/**
 * Internal helper to process and create a single OutletInventoryTransaction.
 * This function handles validation, data snapshots, OIT creation, and inventory syncing.
 * It does NOT send an HTTP response directly.
 *
 * @param {object} transactionDataPayload - The data for a single OIT (from req.body or array item).
 * @param {object} authenticatedUser - The authenticated user object (e.g., req.user).
 * @param {object|null} uploadedFile - The Multer file object if any, for evidence.
 * @returns {Promise<{success: boolean, message: string, transaction?: object, errors?: string[], fileToDelete?: string}>}
 */
const _processSingleOutletInventoryTransaction = async (transactionDataPayload, authenticatedUser, uploadedFile = null) => {
    const { ingredientId, outletId, sourceType, ref, transactionType, notes } = transactionDataPayload;
    let qty = transactionDataPayload.qty; // Use let as it might be parsed
    const errors = [];
    let fileToDelete = null; // Path to file if uploaded but validation fails

    try {
        // --- Basic Validation ---
        if (!ingredientId || !mongoose.Types.ObjectId.isValid(ingredientId)) {
            errors.push('ID Bahan tidak valid.');
        }
        if (!outletId || !mongoose.Types.ObjectId.isValid(outletId)) {
            errors.push('ID Outlet tidak valid.');
        }
        if (!Object.values(SourceTypes).includes(sourceType)) {
            errors.push('Jenis sumber transaksi tidak valid.');
        }
        if (!ref || ref.trim() === '') {
            errors.push('Referensi sumber transaksi diperlukan.');
        }
        if (!Object.values(TransactionTypes).includes(transactionType)) {
            errors.push('Jenis transaksi tidak valid.');
        }
        if (qty === undefined || typeof qty === 'string') {
            const parsedQty = parseFloat(qty);
            if (isNaN(parsedQty)) {
                errors.push('Jumlah (qty) harus berupa angka yang valid.');
            } else {
                qty = parsedQty;
            }
        }
        if (typeof qty !== 'number') {
            errors.push('Jumlah (qty) diperlukan dan harus berupa angka.');
        }
        if (notes !== undefined && typeof notes !== 'string') {
            errors.push('Catatan harus berupa string.');
        } else if (notes !== undefined) {
            transactionDataPayload.notes = notes.trim(); // Update the payload's notes
        }


        // --- Data Snapshots & Existence Checks ---
        let ingredientSnapshot;
        let outletSnapshot;
        let createdBySnapshot;

        // Ingredient
        const ingredientDoc = await Ingredient.findById(ingredientId);
        if (!ingredientDoc || ingredientDoc.isDeleted) {
            errors.push('Bahan tidak ditemukan atau sudah dihapus.');
        } else {
            ingredientSnapshot = {
                ingredientId: ingredientDoc._id,
                name: ingredientDoc.name,
                unit: ingredientDoc.unit,
            };
        }

        // Outlet
        const outletDoc = await Outlet.findById(outletId);
        if (!outletDoc || outletDoc.isDeleted || !outletDoc.isActive) {
            errors.push('Outlet tidak ditemukan, sudah dihapus, atau tidak aktif.');
        } else {
            outletSnapshot = {
                outletId: outletDoc._id,
                name: outletDoc.name,
                address: outletDoc.address,
            };
        }

        // CreatedBy (from authenticatedUser)
        if (!authenticatedUser || !authenticatedUser._id || !authenticatedUser.name) {
            errors.push('Informasi pengguna pembuat tidak tersedia. Pastikan pengguna terautentikasi.');
        } else {
            const user = await validateUserReference(authenticatedUser._id, errors, 'pembuat transaksi');
            if (user) {
                createdBySnapshot = { userId: user.userId, name: user.name };
            }
        }

        // --- Transaction-specific Quantity Validation ---
        switch (transactionType) {
            case TransactionTypes.IN:
                if (qty <= 0) errors.push('Jumlah (qty) untuk transaksi "IN" harus positif.');
                break;
            case TransactionTypes.OUT:
            case TransactionTypes.SPOILAGE:
                if (qty <= 0) errors.push('Jumlah (qty) untuk transaksi "OUT" atau "SPOILAGE" harus positif sebelum konversi ke negatif.');
                break;
            case TransactionTypes.ADJUSTMENT:
                // qty can be positive or negative, no specific sign validation here
                break;
        }

        // Handle evidence file upload
        const evidenceUrl = getEvidenceUrl(uploadedFile, 'uploads/inventory_evidence');
        if (uploadedFile && errors.length > 0) {
            fileToDelete = uploadedFile.path; // Mark file for deletion if initial validation fails
        }


        if (errors.length > 0) {
            return { success: false, message: 'Validasi gagal.', errors, fileToDelete };
        }

        // Construct transaction data
        const transactionData = {
            ingredient: ingredientSnapshot,
            price: ingredientDoc.price,
            outlet: outletSnapshot,
            source: { sourceType, ref },
            transactionType,
            qty, // Qty will be adjusted for sign by model's pre-save hook
            notes: transactionDataPayload.notes, // Use the trimmed notes
            createdBy: createdBySnapshot,
            evidenceUrl,
            isValid: true, // Default to true for transactions created via controller, can be overridden by specific logic
            isCalculated: false, // Default to false, waiting for sync service
        };

        const newTransaction = await OutletInventoryTransaction.create(transactionData);

        // Call the service to sync the outlet inventory
        const syncSuccess = await outletInventoryService.syncOutletInventory(
            newTransaction,
            { userId: authenticatedUser._id, userName: authenticatedUser.name }
        );

        if (!syncSuccess) {
            console.warn(`Failed to sync OutletInventory for new transaction ${newTransaction.id}. Manual intervention might be required.`);
            // Decide how to handle a sync failure. For critical applications, you might
            // want to mark the OIT as invalid or rollback. For now, it logs a warning.
        }

        return { success: true, message: 'Transaksi inventori outlet berhasil dicatat.', transaction: newTransaction.toJSON() };

    } catch (error) {
        console.error('Error in _processSingleOutletInventoryTransaction:', error);
        return { success: false, message: `Kesalahan saat memproses transaksi: ${error.message}`, errors: [error.message], fileToDelete };
    }
};


// @desc    Create a new outlet inventory transaction
// @route   POST /api/v1/outletinventorytransactions
// @access  Private (Operator, Admin, SPV Area - depending on transaction type)
export const createOutletInventoryTransaction = async (req, res) => {
    try {
        const result = await _processSingleOutletInventoryTransaction(req.body, req.user, req.file);

        if (result.fileToDelete) {
            try { await fs.unlink(result.fileToDelete); } catch (fileErr) { console.error(`Error deleting redundant file ${result.fileToDelete}:`, fileErr); }
        }

        if (result.success) {
            res.status(201).json({ message: result.message, transaction: result.transaction });
        } else {
            res.status(400).json({ message: result.message, errors: result.errors });
        }

    } catch (error) {
        // Handle Multer-specific errors that might occur before _processSingleOutletInventoryTransaction is called
        if (error instanceof multer.MulterError) {
            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ message: 'Ukuran file terlalu besar. Maksimal 10MB.' });
            }
            return res.status(400).json({ message: `Kesalahan unggah file: ${error.message}` });
        }
        if (error.message.includes('Hanya file gambar')) { // Custom fileFilter error
            return res.status(400).json({ message: error.message });
        }
        console.error('Kesalahan saat membuat transaksi inventori outlet:', error);
        res.status(500).json({ message: 'Kesalahan server saat membuat transaksi inventori outlet.', error: error.message });
    }
};

// @desc    Create multiple outlet inventory transactions from a list
// @route   POST /api/v1/outletinventorytransactions/bulk
// @access  Private (Admin, SPV Area, or specific roles that can bulk create)
export const createMultipleOutletInventoryTransactions = async (req, res) => {
    try {
        const transactionsToCreate = req.body;
        const results = [];
        const filesToDelete = [];

        if (!Array.isArray(transactionsToCreate) || transactionsToCreate.length === 0) {
            return res.status(400).json({ message: 'Payload harus berupa array transaksi non-kosong.' });
        }

        // Multer only handles one file per request. If multiple files are expected for bulk upload,
        // you'd need a different multer setup (e.g., array('evidenceFiles')) and map them to transactions.
        // For simplicity, this assumes either no file, or if a file is uploaded with bulk,
        // it applies to the first transaction or is ignored for subsequent ones.
        // For distinct files per transaction in a bulk request, the client would need to send
        // multiple requests or a more complex multipart form data structure.
        const singleFile = req.file; // If a single file was uploaded with the bulk request

        for (let i = 0; i < transactionsToCreate.length; i++) {
            const transactionPayload = transactionsToCreate[i];
            // Pass the single file only to the first transaction, or if your logic implies it's for one
            const fileForThisTransaction = (i === 0) ? singleFile : null;

            const result = await _processSingleOutletInventoryTransaction(
                transactionPayload,
                req.user,
                fileForThisTransaction
            );
            results.push({ index: i, ...result });

            if (result.fileToDelete) {
                filesToDelete.push(result.fileToDelete);
            }
        }

        // Clean up any files marked for deletion
        for (const filePath of filesToDelete) {
            try {
                await fs.unlink(filePath);
                console.log(`Deleted redundant uploaded file after bulk processing: ${filePath}`);
            } catch (fileErr) {
                console.error(`Error deleting redundant file ${filePath} after bulk processing:`, fileErr);
            }
        }

        const successfulCreations = results.filter(r => r.success);
        const failedCreations = results.filter(r => !r.success);

        console.log(failedCreations);

        if (failedCreations.length === 0) {
            res.status(201).json({
                message: 'Semua transaksi inventori outlet berhasil dicatat.',
                results: results.map(r => ({ index: r.index, success: r.success, message: r.message, transaction: r.transaction }))
            });
        } else if (successfulCreations.length === 0) {
            res.status(400).json({
                message: 'Semua transaksi gagal dicatat.',
                results: results.map(r => ({ index: r.index, success: r.success, message: r.message, errors: r.errors }))
            });
        } else {
            res.status(207).json({ // 207 Multi-Status
                message: 'Beberapa transaksi berhasil dicatat, beberapa gagal.',
                successful: successfulCreations.map(r => ({ index: r.index, message: r.message, transaction: r.transaction })),
                failed: failedCreations.map(r => ({ index: r.index, message: r.message, errors: r.errors }))
            });
        }

    } catch (error) {
        // Handle Multer-specific errors at the top level
        if (error instanceof multer.MulterError) {
            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ message: 'Ukuran file terlalu besar. Maksimal 10MB.' });
            }
            return res.status(400).json({ message: `Kesalahan unggah file: ${error.message}` });
        }
        if (error.message.includes('Hanya file gambar')) { // Custom fileFilter error
            return res.status(400).json({ message: error.message });
        }
        console.error('Kesalahan saat membuat banyak transaksi inventori outlet:', error);
        res.status(500).json({ message: 'Kesalahan server saat membuat banyak transaksi inventori outlet.', error: error.message });
    }
};


// @desc    Get all outlet inventory transactions
// @route   GET /api/v1/outletinventorytransactions
// @access  Private (Admin, SPV Area, potentially Operator for their outlet)
export const getOutletInventoryTransactions = async (req, res) => {
    try {
        const filter = { isDeleted: false };
        const { outletId, ingredientId, transactionType, sourceType, dateFrom, dateTo, isValid, isCalculated } = req.query;

        // NEW: If outletId is provided in the filter, update the user's currentOutlet
        if (outletId && req.user && req.user._id && mongoose.Types.ObjectId.isValid(outletId)) {
            try {
                // Find and update, or create if not exist (upsert: true)
                await UserOutlet.findByIdAndUpdate(
                    req.user._id,
                    { currentOutlet: outletId },
                    { upsert: true, new: true }
                );
            } catch (userOutletError) {
                console.warn(`Failed to update UserOutlet for user ${req.user._id} with outlet ${outletId}:`, userOutletError.message);
                // Do not block the request if this update fails, it's a secondary function
            }
        }


        if (outletId) {
            if (!mongoose.Types.ObjectId.isValid(outletId)) { return res.status(400).json({ message: 'ID Outlet tidak valid untuk filter.' }); }
            filter['outlet.outletId'] = outletId;
        }
        if (ingredientId) {
            if (!mongoose.Types.ObjectId.isValid(ingredientId)) { return res.status(400).json({ message: 'ID Bahan tidak valid untuk filter.' }); }
            filter['ingredient.ingredientId'] = ingredientId;
        }
        if (transactionType) {
            if (!Object.values(TransactionTypes).includes(transactionType)) { return res.status(400).json({ message: 'Jenis transaksi tidak valid untuk filter.' }); }
            filter.transactionType = transactionType;
        }
        if (sourceType) {
            if (!Object.values(SourceTypes).includes(sourceType)) { return res.status(400).json({ message: 'Jenis sumber tidak valid untuk filter.' }); }
            filter['source.sourceType'] = sourceType;
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
        if (isValid !== undefined) {
            filter.isValid = isValid === 'true';
        }
        if (isCalculated !== undefined) {
            filter.isCalculated = isCalculated === 'true';
        }

        const transactions = await OutletInventoryTransaction.find(filter).sort({ createdAt: -1 });
        res.status(200).json(transactions.map(trx => trx.toJSON()));
    } catch (error) {
        console.error('Kesalahan saat mengambil transaksi inventori outlet:', error);
        res.status(500).json({ message: 'Kesalahan server saat mengambil transaksi inventori outlet.', error: error.message });
    }
};

// @desc    Get a single outlet inventory transaction by ID
// @route   GET /api/v1/outletinventorytransactions/:id
// @access  Private (Admin, SPV Area, potentially Operator for their outlet)
export const getOutletInventoryTransactionById = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Format ID Transaksi Inventori Outlet tidak valid.' });
        }

        const transaction = await OutletInventoryTransaction.findById(id);

        if (!transaction || transaction.isDeleted === true) {
            return res.status(404).json({ message: 'Transaksi inventori outlet tidak ditemukan atau sudah dihapus.' });
        }
        res.status(200).json(transaction.toJSON());
    } catch (error) {
        if (error.name === 'CastError' && error.kind === 'ObjectId') {
            return res.status(400).json({ message: 'Format ID Transaksi Inventori Outlet tidak valid.' });
        }
        console.error('Kesalahan saat mengambil transaksi inventori outlet berdasarkan ID:', error);
        res.status(500).json({ message: 'Kesalahan server saat mengambil transaksi inventori outlet berdasarkan ID.', error: error.message });
    }
};

// @desc    Update an outlet inventory transaction (e.g., mark as valid/calculated)
// @route   PATCH /api/v1/outletinventorytransactions/:id
// @access  Private (Admin, SPV Area for isValid/isCalculated)
export const updateOutletInventoryTransaction = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = { ...req.body };
        const errors = [];

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Format ID Transaksi Inventori Outlet tidak valid.' });
        }

        const existingTransaction = await OutletInventoryTransaction.findById(id);
        if (!existingTransaction || existingTransaction.isDeleted) {
            return res.status(404).json({ message: 'Transaksi inventori outlet tidak ditemukan atau sudah dihapus.' });
        }

        const userContext = { userId: req.user._id, userName: req.user.name };

        // Handle 'isValid' status change using the new toggle function
        if (updateData.isValid !== undefined && typeof updateData.isValid === 'boolean') {
            const toggleSuccess = await outletInventoryService.toggleOutletInventoryTransactionValidation(
                id,
                updateData.isValid, // Pass the desired state
                userContext
            );
            if (!toggleSuccess) {
                errors.push('Gagal mengubah status validasi transaksi inventori.');
            }
            // Remove these fields from updateData as the service function handles their update
            delete updateData.isValid;
            delete updateData.isCalculated;
            delete updateData.calculatedAt;
        }
        // Prevent direct manipulation of isCalculated, let the service handle it
        if (updateData.isCalculated !== undefined) {
            errors.push('Bidang "isCalculated" tidak dapat diperbarui secara langsung.');
        }
        if (updateData.calculatedAt !== undefined) {
            errors.push('Bidang "calculatedAt" tidak dapat diperbarui secara langsung.');
        }

        // Validate notes if provided
        if (updateData.notes !== undefined && typeof updateData.notes !== 'string') {
            errors.push('Catatan harus berupa string.');
        } else if (updateData.notes !== undefined) {
            updateData.notes = updateData.notes.trim();
        }

        if (errors.length > 0) {
            return res.status(400).json({ message: 'Validasi gagal.', errors });
        }

        // Only proceed with update if there are fields left to update (e.g., notes)
        if (Object.keys(updateData).length === 0) {
            // Fetch the latest state of the transaction after service call if no direct updates
            const refreshedTransaction = await OutletInventoryTransaction.findById(id);
            return res.status(200).json({
                message: 'Tidak ada pembaruan yang diperlukan atau semua pembaruan ditangani oleh layanan.',
                transaction: refreshedTransaction ? refreshedTransaction.toJSON() : existingTransaction.toJSON()
            });
        }

        const transaction = await OutletInventoryTransaction.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!transaction) {
            return res.status(404).json({ message: 'Transaksi inventori outlet tidak ditemukan.' });
        }

        res.status(200).json({
            message: 'Transaksi inventori outlet berhasil diperbarui.',
            transaction: transaction.toJSON(),
        });

    } catch (error) {
        if (error.name === 'CastError' && error.kind === 'ObjectId') {
            return res.status(400).json({ message: 'Format ID Transaksi Inventori Outlet tidak valid.' });
        }
        if (error.name === 'ValidationError') {
            const errors = Object.keys(error.errors).map(key => error.errors[key].message);
            return res.status(400).json({ message: 'Validasi gagal.', errors });
        }
        console.error('Kesalahan saat memperbarui transaksi inventori outlet:', error);
        res.status(500).json({ message: 'Kesalahan server saat memperbarui transaksi inventori outlet.', error: error.message });
    }
};

// @desc    Soft delete an outlet inventory transaction (Admin only)
// @route   DELETE /api/v1/outletinventorytransactions/:id
// @access  Private (Admin role)
export const deleteOutletInventoryTransaction = async (req, res) => {
    let transactionToDelete = null; // Store for potential service call
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Format ID Transaksi Inventori Outlet tidak valid.' });
        }

        // Security check: Ensure only Admin can perform this soft delete
        if (!req.user || !req.user.roles || !req.user.roles.includes(Roles.admin)) {
            return res.status(403).json({ message: 'Anda tidak memiliki izin untuk menghapus transaksi inventori outlet ini.' });
        }

        // Fetch the transaction *before* deleting it to get its current state for reversal
        transactionToDelete = await OutletInventoryTransaction.findById(id);
        if (!transactionToDelete || transactionToDelete.isDeleted) {
             return res.status(404).json({ message: 'Transaksi inventori outlet tidak ditemukan atau sudah dihapus.' });
        }

        // NEW: Invalidate the linked OIT using the toggle function if it was valid
        if (transactionToDelete.isValid === true) {
            const userContext = req.user ? { userId: req.user._id, userName: req.user.name } : { userId: null, name: 'System' };
            const invalidateSuccess = await outletInventoryService.toggleOutletInventoryTransactionValidation(
                id, // Pass the transaction ID
                false, // Set isValid to false
                userContext
            );
            if (!invalidateSuccess) {
                console.error(`Failed to invalidate OIT ${id} during soft delete. Proceeding with soft delete anyway.`);
                // Decide if you want to prevent delete on invalidation failure
            }
        }

        // Now, proceed with soft deleting the OIT document itself
        const transaction = await OutletInventoryTransaction.findByIdAndUpdate(
            id,
            { isDeleted: true, deletedAt: new Date(), deletedBy: req.user._id },
            { new: true }
        );


        res.status(200).json({
            message: 'Transaksi inventori outlet berhasil dihapus (soft delete).',
            transaction: transaction.toJSON(),
        });
    } catch (error) {
        if (error.name === 'CastError' && error.kind === 'ObjectId') {
            return res.status(400).json({ message: 'Format ID Transaksi Inventori Outlet tidak valid.' });
        }
        console.error('Kesalahan saat menghapus transaksi inventori outlet:', error);
        res.status(500).json({ message: 'Kesalahan server saat menghapus transaksi inventori outlet.', error: error.message });
    }
};
