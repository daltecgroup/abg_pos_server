import OutletInventoryTransaction from '../models/OutletInventoryTransaction.js';
import Outlet from '../models/Outlet.js';
import Ingredient from '../models/Ingredient.js';
import User from '../models/User.js';
import { TransactionTypes } from '../constants/transactionTypes.js';
import { SourceTypes } from '../constants/sourceTypes.js';
import { Roles } from '../constants/roles.js';
import mongoose from 'mongoose';
import multer from 'multer'; // For Multer error handling

// NEW: Import the new service layer
import * as outletInventoryService from '../services/outletInventoryService.js';


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
const getEvidenceUrl = (req, uploadDirectory) => {
    if (req.file) {
        return `/${uploadDirectory}/${req.file.filename}`;
    }
    return null;
};

// --- CRUD Controller Functions for OutletInventoryTransaction ---

// @desc    Create a new outlet inventory transaction
// @route   POST /api/v1/outletinventorytransactions
// @access  Private (Operator, Admin, SPV Area - depending on transaction type)
export const createOutletInventoryTransaction = async (req, res) => {
    let createdTransaction = null; // Store for potential service call or rollback
    try {
        let { ingredientId, outletId, sourceType, ref, transactionType, qty, notes } = req.body;
        const errors = [];

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
        if (qty === undefined || typeof qty === 'string') { // Allow string, parse it
            const parsedQty = parseFloat(qty);
            if (isNaN(parsedQty)) {
                errors.push('Jumlah (qty) harus berupa angka yang valid.');
            } else {
                qty = parsedQty; // Update qty to its numeric value
            }
        }
        if (typeof qty !== 'number') { // Final check after potential parsing
            errors.push('Jumlah (qty) diperlukan dan harus berupa angka.');
        }
        if (notes !== undefined && typeof notes !== 'string') {
            errors.push('Catatan harus berupa string.');
        } else if (notes !== undefined) {
            notes = notes.trim();
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

        // CreatedBy (from req.user)
        if (!req.user || !req.user._id || !req.user.name) {
            errors.push('Informasi pengguna pembuat tidak tersedia. Pastikan pengguna terautentikasi.');
        } else {
            const user = await validateUserReference(req.user._id, errors, 'pembuat transaksi');
            if (user) {
                createdBySnapshot = { userId: user.userId, name: user.name };
            }
        }

        // --- Transaction-specific Quantity Validation (before model's pre-save adjusts sign) ---
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
        const evidenceUrl = getEvidenceUrl(req, 'uploads/inventory_evidence');
        // You can add logic here if evidence is mandatory for certain transaction types
        // For example: if (transactionType === TransactionTypes.ADJUSTMENT && !evidenceUrl) errors.push('Bukti diperlukan untuk penyesuaian.');


        if (errors.length > 0) {
            // If a file was uploaded but validation fails, delete the uploaded file
            if (req.file) {
                const fs = await import('fs/promises');
                try {
                    await fs.unlink(req.file.path);
                    console.log(`Deleted redundant uploaded file: ${req.file.path}`);
                } catch (fileErr) {
                    console.error(`Error deleting redundant file ${req.file.path}:`, fileErr);
                }
            }
            return res.status(400).json({ message: 'Validasi gagal.', errors });
        }

        // Construct transaction data
        const transactionData = {
            ingredient: ingredientSnapshot,
            price: ingredientDoc.price, // Snapshot current ingredient price
            outlet: outletSnapshot,
            source: { sourceType, ref },
            transactionType,
            qty, // Qty will be adjusted for sign by model's pre-save hook
            notes,
            createdBy: createdBySnapshot,
            evidenceUrl,
            isValid: false, // Default to false, waiting for Admin/SPV Area validation
            isCalculated: false, // Default to false, waiting for sync service
        };

        const newTransaction = await OutletInventoryTransaction.create(transactionData);
        createdTransaction = newTransaction; // Store the created transaction

        // NEW: Call the service to sync the outlet inventory
        // The service will set isCalculated to true if successful
        const syncSuccess = await outletInventoryService.syncOutletInventory(
            newTransaction,
            { userId: req.user._id, userName: req.user.name } // Pass user context
        );

        if (!syncSuccess) {
            // If sync fails here, log error. Consider rolling back OIT isValid to false if critical.
            // For now, proceed but it means inventory might be inconsistent.
            console.warn(`Failed to sync OutletInventory for new transaction ${newTransaction.id}.`);
        }


        res.status(201).json({
            message: 'Transaksi inventori outlet berhasil dicatat.',
            transaction: newTransaction.toJSON(),
        });

    } catch (error) {
        // If a file was uploaded but an unexpected error occurs, delete the uploaded file
        if (req.file) {
            const fs = await import('fs/promises');
            try {
                await fs.unlink(req.file.path);
                console.log(`Deleted redundant uploaded file: ${req.file.path}`);
            } catch (fileErr) {
                console.error(`Error deleting redundant file ${req.file.path}:`, fileErr);
            }
        }
        if (error.code === 11000) {
            const field = Object.keys(error.keyValue)[0];
            const value = error.keyValue[field];
            return res.status(409).json({ message: `Transaksi inventori dengan ${field} '${value}' sudah ada.` });
        }
        if (error.name === 'ValidationError') {
            const errors = Object.keys(error.errors).map(key => error.errors[key].message);
            return res.status(400).json({ message: 'Validasi gagal.', errors });
        }
        // Handle Multer-specific errors
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

// @desc    Get all outlet inventory transactions
// @route   GET /api/v1/outletinventorytransactions
// @access  Private (Admin, SPV Area, potentially Operator for their outlet)
export const getOutletInventoryTransactions = async (req, res) => {
    try {
        const filter = { isDeleted: false };
        const { outletId, ingredientId, transactionType, sourceType, dateFrom, dateTo, isValid, isCalculated } = req.query;

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
