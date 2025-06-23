import Sale from '../models/Sale.js';
import Outlet from '../models/Outlet.js';
import User from '../models/User.js';
import Menu from '../models/Menu.js';
import Addon from '../models/Addon.js';
import Bundle from '../models/Bundle.js';
import Ingredient from '../models/Ingredient.js'; // NEW: Import Ingredient model
import { PaymentMethods } from '../constants/paymentMethods.js';
import { Roles } from '../constants/roles.js';
import mongoose from 'mongoose';
import multer from 'multer'; // Import multer for error handling

// --- Helper Functions ---

// Helper to validate User references (Operator, createdBy, invoicePrintHistory.userId)
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
  return { userId: user._id, name: user.name }; // Return object with _id and name
};

// Helper for image upload path for payment evidence
const getPaymentEvidenceUrl = (req) => {
  if (req.file) {
    // Assuming Multer and image processing middleware save to /uploads/payment_evidence
    return `/uploads/payment/evidence/${req.file.filename}`;
  }
  return null;
};

// --- CRUD Controller Functions for Sale ---

// @desc    Create a new sale
// @route   POST /api/v1/sales
// @access  Private (Operator role)
export const createSale = async (req, res) => {
  try {
    const { outletId, itemSingle, itemBundle, itemPromo, payment } = req.body;
    let {totalPaid} = req.body;
    const errors = [];
    let calculatedTotalPrice = 0;
    const ingredientsConsumedMap = new Map(); // To aggregate ingredient usage

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

    // --- Validate Operator (from req.user) ---
    let operatorSnapshot;
    if (!req.user || !req.user._id || !req.user.name) {
      errors.push('Informasi operator tidak tersedia. Pastikan pengguna terautentikasi.');
    } else {
      const user = await validateUserReference(req.user._id, errors, 'operator', Roles.operator);
      if (user) {
        operatorSnapshot = { operatorId: user.userId, name: user.name };
      }
    }

    // --- Process itemSingle and calculate ingredients used ---
    const processedItemSingle = [];
    if (itemSingle && Array.isArray(itemSingle)) {
      for (const item of itemSingle) {
        if (!item.menuId || !mongoose.Types.ObjectId.isValid(item.menuId) || item.qty === undefined || item.qty < 1) {
          errors.push('Item tunggal memiliki format ID menu atau jumlah yang tidak valid.');
          continue;
        }
        const menu = await Menu.findById(item.menuId); // Fetch menu to get its recipe
        if (!menu || menu.isDeleted || !menu.isActive) {
          errors.push(`Menu ID '${item.menuId}' di item tunggal tidak ditemukan, sudah dihapus, atau tidak aktif.`);
          continue;
        }

        let itemSingleSubtotal = item.qty * menu.price;
        let itemSingleDiscountAmount = 0;

        if (item.discount !== undefined) {
          if (typeof item.discount !== 'number' || item.discount < 0 || item.discount > 100) {
            errors.push(`Diskon untuk menu '${menu.name}' tidak valid.`);
          } else {
            itemSingleDiscountAmount = (item.discount / 100) * itemSingleSubtotal;
            itemSingleSubtotal -= itemSingleDiscountAmount;
          }
        } else {
            item.discount = 0;
        }

        // Process addons for this single item
        const processedAddons = [];
        if (item.addons && Array.isArray(item.addons)) {
          for (const addonItem of item.addons) {
            if (!addonItem.addonId || !mongoose.Types.ObjectId.isValid(addonItem.addonId) || addonItem.qty === undefined || addonItem.qty < 1) {
              errors.push('Addon memiliki format ID addon atau jumlah yang tidak valid.');
              continue;
            }
            const addon = await Addon.findById(addonItem.addonId);
            if (!addon || addon.isDeleted || !addon.isActive) {
              errors.push(`Addon ID '${addonItem.addonId}' tidak ditemukan, sudah dihapus, atau tidak aktif.`);
              continue;
            }
            processedAddons.push({
              addonId: addon._id,
              name: addon.name,
              qty: addonItem.qty,
              price: addon.price,
            });
            itemSingleSubtotal += addonItem.qty * addon.price;

            // NEW: Add addon ingredients to ingredientsConsumedMap (if addons have recipes)
            if (addon.recipe && Array.isArray(addon.recipe)) { // Assuming addons can also have recipes
              for (const recipeIngredient of addon.recipe) {
                if (!recipeIngredient.ingredientId || recipeIngredient.qty === undefined || recipeIngredient.qty < 0) continue;
                const ingredient = await Ingredient.findById(recipeIngredient.ingredientId);
                const consumedQty = addonItem.qty * recipeIngredient.qty;
                const consumedExpense = ingredient ? (consumedQty * ingredient.price) : 0;
                const ingredientName = ingredient ? ingredient.name : null;
                const ingredientUnit = ingredient ? ingredient.unit : null;

                const current = ingredientsConsumedMap.get(recipeIngredient.ingredientId.toString()) || { qty: 0, expense: 0, name: ingredientName, unit: ingredientUnit };
                ingredientsConsumedMap.set(recipeIngredient.ingredientId.toString(), {
                  ingredientId: recipeIngredient.ingredientId,
                  name: current.name,
                  qty: current.qty + consumedQty,
                  expense: current.expense + consumedExpense,
                  unit: current.unit
                });
              }
            }
          }
        }

        processedItemSingle.push({
          menuId: menu._id,
          name: menu.name,
          qty: item.qty,
          price: menu.price,
          discount: item.discount,
          notes: item.notes || null,
          addons: processedAddons,
        });
        calculatedTotalPrice += itemSingleSubtotal;

        // NEW: Add menu ingredients to ingredientsConsumedMap
        if (menu.recipe && Array.isArray(menu.recipe)) {
          for (const recipeIngredient of menu.recipe) {
            if (!recipeIngredient.ingredientId || recipeIngredient.qty === undefined || recipeIngredient.qty < 0) continue;
            const ingredient = await Ingredient.findById(recipeIngredient.ingredientId);
            const consumedQty = item.qty * recipeIngredient.qty;
            const consumedExpense = ingredient ? (consumedQty * ingredient.price) : 0;
            const ingredientName = ingredient ? ingredient.name : null;
            const ingredientUnit = ingredient ? ingredient.unit : null;

            const current = ingredientsConsumedMap.get(recipeIngredient.ingredientId.toString()) || { qty: 0, expense: 0, name: ingredientName, unit: ingredientUnit };
            ingredientsConsumedMap.set(recipeIngredient.ingredientId.toString(), {
              ingredientId: recipeIngredient.ingredientId,
              name: current.name,
              qty: current.qty + consumedQty,
              expense: current.expense + consumedExpense,
              unit: current.unit
            });
          }
        }
      }
    }

    // --- Process itemBundle and calculate ingredients used ---
    const processedItemBundle = [];
    if (itemBundle && Array.isArray(itemBundle)) {
      for (const bundleItem of itemBundle) {
        if (!bundleItem.menuBundleId || !mongoose.Types.ObjectId.isValid(bundleItem.menuBundleId) || bundleItem.qty === undefined || bundleItem.qty < 1) {
          errors.push('Item paket memiliki format ID paket atau jumlah yang tidak valid.');
          continue;
        }
        const bundle = await Bundle.findById(bundleItem.menuBundleId);
        if (!bundle || bundle.isDeleted || !bundle.isActive) {
          errors.push(`Paket ID '${bundleItem.menuBundleId}' tidak ditemukan, sudah dihapus, atau tidak aktif.`);
          continue;
        }

        const processedBundleMenus = [];
        if (bundleItem.items && Array.isArray(bundleItem.items)) {
            for (const chosenMenuItem of bundleItem.items) {
                if (!chosenMenuItem.menuId || !mongoose.Types.ObjectId.isValid(chosenMenuItem.menuId) || chosenMenuItem.qty === undefined || chosenMenuItem.qty < 1) {
                    errors.push('Menu dalam paket memiliki format ID menu atau jumlah yang tidak valid.');
                    continue;
                }
                const chosenMenu = await Menu.findById(chosenMenuItem.menuId); // Fetch chosen menu to get its recipe
                if (!chosenMenu || chosenMenu.isDeleted || !chosenMenu.isActive) {
                    errors.push(`Menu ID '${chosenMenuItem.menuId}' dalam paket tidak ditemukan, sudah dihapus, atau tidak aktif.`);
                    continue;
                }
                processedBundleMenus.push({
                    menuId: chosenMenu._id,
                    name: chosenMenu.name,
                    qty: chosenMenuItem.qty,
                    price: chosenMenu.price
                });

                // NEW: Add chosen menu ingredients from bundle to ingredientsConsumedMap
                if (chosenMenu.recipe && Array.isArray(chosenMenu.recipe)) {
                  for (const recipeIngredient of chosenMenu.recipe) {
                    if (!recipeIngredient.ingredientId || recipeIngredient.qty === undefined || recipeIngredient.qty < 0) continue;
                    const ingredient = await Ingredient.findById(recipeIngredient.ingredientId);
                    // Crucial: Multiply by bundleItem.qty AND chosenMenuItem.qty
                    const consumedQty = bundleItem.qty * chosenMenuItem.qty * recipeIngredient.qty;
                    const consumedExpense = ingredient ? (consumedQty * ingredient.price) : 0;
                    const ingredientName = ingredient ? ingredient.name : null;
                    const ingredientUnit = ingredient ? ingredient.unit : null;

                    const current = ingredientsConsumedMap.get(recipeIngredient.ingredientId.toString()) || { qty: 0, expense: 0, name: ingredientName, unit: ingredientUnit };
                    ingredientsConsumedMap.set(recipeIngredient.ingredientId.toString(), {
                      ingredientId: recipeIngredient.ingredientId,
                      name: current.name,
                      qty: current.qty + consumedQty,
                      expense: current.expense + consumedExpense,
                      unit: current.unit
                    });
                  }
                }
            }
        }

        processedItemBundle.push({
          menuBundleId: bundle._id,
          name: bundle.name,
          qty: bundleItem.qty,
          price: bundle.price,
          items: processedBundleMenus,
        });
        calculatedTotalPrice += bundleItem.qty * bundle.price;
      }
    }

    // --- Process itemPromo and calculate ingredients used ---
    const processedItemPromo = [];
    if (itemPromo && Array.isArray(itemPromo)) {
      for (const promoItem of itemPromo) {
        if (!promoItem.menuId || !mongoose.Types.ObjectId.isValid(promoItem.menuId) || promoItem.qty === undefined || promoItem.qty < 1) {
          errors.push('Item promo memiliki format ID menu atau jumlah yang tidak valid.');
          continue;
        }
        const menu = await Menu.findById(promoItem.menuId); // Fetch menu to get its recipe
        if (!menu || menu.isDeleted || !menu.isActive) {
          errors.push(`Menu ID '${promoItem.menuId}' di item promo tidak ditemukan, sudah dihapus, atau tidak aktif.`);
          continue;
        }
        processedItemPromo.push({
          menuId: menu._id,
          name: menu.name,
          qty: promoItem.qty,
        });
        // Promo items don't add to total price, but their ingredients are consumed

        // NEW: Add promo menu ingredients to ingredientsConsumedMap
        if (menu.recipe && Array.isArray(menu.recipe)) {
          for (const recipeIngredient of menu.recipe) {
            if (!recipeIngredient.ingredientId || recipeIngredient.qty === undefined || recipeIngredient.qty < 0) continue;
            const ingredient = await Ingredient.findById(recipeIngredient.ingredientId);
            const consumedQty = promoItem.qty * recipeIngredient.qty;
            const consumedExpense = ingredient ? (consumedQty * ingredient.price) : 0;
            const ingredientName = ingredient ? ingredient.name : null;
            const ingredientUnit = ingredient ? ingredient.unit : null;

            const current = ingredientsConsumedMap.get(recipeIngredient.ingredientId.toString()) || { qty: 0, expense: 0, name: ingredientName, unit: ingredientUnit };
            ingredientsConsumedMap.set(recipeIngredient.ingredientId.toString(), {
              ingredientId: recipeIngredient.ingredientId,
              name: current.name,
              qty: current.qty + consumedQty,
              expense: current.expense + consumedExpense,
              unit: current.unit
            });
          }
        }
      }
    }

    // --- Validate Payment ---
    if (!payment || !payment.method || !Object.values(PaymentMethods).includes(payment.method)) {
      errors.push('Metode pembayaran tidak valid.');
    }
    const evidenceUrl = getPaymentEvidenceUrl(req); // Get evidence URL from uploaded file
    if (payment.method !== PaymentMethods.CASH && !evidenceUrl) {
      errors.push('Bukti pembayaran diperlukan untuk metode pembayaran non-tunai (Transfer, QRIS).');
    }
    // Update payment object with evidenceUrl
    payment.evidenceUrl = evidenceUrl;

    // NEW: Convert totalPaid to number if it's a string
    if (typeof totalPaid === 'string') {
        const parsedTotalPaid = parseFloat(totalPaid);
        if (isNaN(parsedTotalPaid)) {
            errors.push('Jumlah dibayar ("totalPaid") harus berupa angka yang valid.');
        } else {
            totalPaid = parsedTotalPaid; // Update totalPaid to its numeric value
        }
    }

    // --- Validate totalPaid ---
    if (totalPaid === undefined || typeof totalPaid !== 'number' || totalPaid < 0) {
      errors.push('Jumlah dibayar ("totalPaid") diperlukan dan harus berupa angka non-negatif.');
    }
    if (totalPaid < calculatedTotalPrice) {
      errors.push(`Jumlah dibayar (${totalPaid}) kurang dari total harga (${calculatedTotalPrice}).`);
    }

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

    // Convert ingredientsConsumedMap to array for the schema
    const finalIngredientUsed = Array.from(ingredientsConsumedMap.values());


    // --- Construct Sale Data ---
    const saleData = {
      outlet: outletSnapshot,
      operator: operatorSnapshot,
      itemSingle: processedItemSingle,
      itemBundle: processedItemBundle,
      itemPromo: processedItemPromo,
      totalPrice: calculatedTotalPrice,
      totalPaid: totalPaid,
      payment: payment,
      ingredientUsed: finalIngredientUsed, // NEW: Add the calculated ingredientUsed
      // invoicePrintHistory will be empty on creation
      // isValid defaults to true
      // isDeleted defaults to false
    };

    const sale = await Sale.create(saleData); // Code will be generated by pre-save hook
    res.status(201).json({
      message: 'Penjualan berhasil dicatat.',
      sale: sale.toJSON()
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
      return res.status(409).json({ message: `Penjualan dengan ${field} '${value}' sudah ada.` });
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
    console.error('Kesalahan saat membuat penjualan:', error);
    res.status(500).json({ message: 'Kesalahan server saat membuat penjualan.', error: error.message });
  }
};

// @desc    Get all sales
// @route   GET /api/v1/sales
// @access  Private (Admin, SPV Area)
export const getSales = async (req, res) => {
  try {
    const filter = { isDeleted: false };
    const { outletId, operatorId, dateFrom, dateTo, isValid, paymentMethod } = req.query;

    if (outletId) {
      if (!mongoose.Types.ObjectId.isValid(outletId)) {
        return res.status(400).json({ message: 'ID Outlet tidak valid untuk filter.' });
      }
      filter['outlet.outletId'] = outletId;
    }
    if (operatorId) {
      if (!mongoose.Types.ObjectId.isValid(operatorId)) {
        return res.status(400).json({ message: 'ID Operator tidak valid untuk filter.' });
      }
      filter['operator.operatorId'] = operatorId;
    }
    if (dateFrom || dateTo) {
      filter.createdAt = {}; // Filter by createdAt for sale date
      if (dateFrom) {
        const d = new Date(dateFrom);
        if (isNaN(d.getTime())) { return res.status(400).json({ message: 'Format tanggal "dateFrom" tidak valid.' }); }
        filter.createdAt.$gte = d;
      }
      if (dateTo) {
        const d = new Date(dateTo);
        if (isNaN(d.getTime())) { return res.status(400).json({ message: 'Format tanggal "dateTo" tidak valid.' }); }
        filter.createdAt.$lte = new Date(d.getTime() + 24 * 60 * 60 * 1000 - 1); // Up to the last millisecond of dateTo
      }
    }
    if (isValid !== undefined) {
      filter.isValid = isValid === 'true';
    }
    if (paymentMethod) {
        if (!Object.values(PaymentMethods).includes(paymentMethod)) {
            return res.status(400).json({ message: 'Metode pembayaran tidak valid untuk filter.' });
        }
        filter['payment.method'] = paymentMethod;
    }


    const sales = await Sale.find(filter).sort({ createdAt: -1 });
    res.status(200).json(sales.map(sale => sale.toJSON()));
  } catch (error) {
    console.error('Kesalahan saat mengambil penjualan:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengambil penjualan.', error: error.message });
  }
};

// @desc    Get a single sale by ID
// @route   GET /api/v1/sales/:id
// @access  Private (Admin, SPV Area, Operator - operator can only view their own outlet's sales)
export const getSaleById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Penjualan tidak valid.' });
    }

    const sale = await Sale.findById(id);

    if (!sale || sale.isDeleted === true) {
      return res.status(404).json({ message: 'Penjualan tidak ditemukan atau sudah dihapus.' });
    }

    // Optional Security: If req.user is operator, check if outlet matches
    if (req.user && req.user.roles.includes(Roles.operator)) {
        // Assuming req.user has outletId or you fetch it here
        const operatorOutlet = await Outlet.findOne({ operators: req.user._id, isDeleted: false });
        if (!operatorOutlet || operatorOutlet._id.toString() !== sale.outlet.outletId.toString()) {
            return res.status(403).json({ message: 'Anda tidak diizinkan untuk melihat penjualan ini.' });
        }
    }

    res.status(200).json(sale.toJSON());
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Format ID Penjualan tidak valid.' });
    }
    console.error('Kesalahan saat mengambil penjualan berdasarkan ID:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengambil penjualan.', error: error.message });
  }
};

// @desc    Update a sale (e.g., mark as invalid, add print history)
// @route   PATCH /api/v1/sales/:id
// @access  Private (Admin, or specific roles for certain updates like isValid)
export const updateSale = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    const errors = [];

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Penjualan tidak valid.' });
    }

    const existingSale = await Sale.findById(id);
    if (!existingSale || existingSale.isDeleted) {
      return res.status(404).json({ message: 'Penjualan tidak ditemukan atau sudah dihapus.' });
    }

    // --- Validation for fields that can be updated ---
    if (updateData.isValid !== undefined && typeof updateData.isValid !== 'boolean') {
      errors.push('Nilai "isValid" harus berupa boolean.');
    }
    if (updateData.totalPaid !== undefined && (typeof updateData.totalPaid !== 'number' || updateData.totalPaid < 0)) {
      errors.push('Jumlah dibayar ("totalPaid") harus berupa angka non-negatif.');
    }
    if (updateData.payment && updateData.payment.method !== undefined && !Object.values(PaymentMethods).includes(updateData.payment.method)) {
      errors.push('Metode pembayaran tidak valid.');
    }

    // Handle invoicePrintHistory addition
    if (updateData.addInvoicePrintHistory) { // Custom field to trigger this action
        const userId = req.user?._id; // Assuming user ID from auth
        if (!userId) {
            errors.push('ID Pengguna tidak tersedia untuk catatan riwayat cetak faktur.');
        } else {
            const userDetails = await validateUserReference(userId, errors, 'riwayat cetak faktur');
            if (userDetails) {
                // Ensure invoicePrintHistory array exists
                if (!existingSale.invoicePrintHistory) {
                    existingSale.invoicePrintHistory = [];
                }
                existingSale.invoicePrintHistory.push({
                    userId: userDetails.userId,
                    printedAt: new Date(),
                });
                // Remove the custom trigger field
                delete updateData.addInvoicePrintHistory;
            }
        }
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }

    // Apply updates (excluding the custom trigger field)
    const sale = await Sale.findByIdAndUpdate(
      id,
      { $set: updateData }, // Use $set to update specific fields, preserving others
      { new: true, runValidators: true } // runValidators for schema level validation
    );

    res.status(200).json({
      message: 'Penjualan berhasil diperbarui.',
      sale: sale.toJSON()
    });

  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Format ID Penjualan tidak valid.' });
    }
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    console.error('Kesalahan saat memperbarui penjualan:', error);
    res.status(500).json({ message: 'Kesalahan server saat memperbarui penjualan.', error: error.message });
  }
};

// @desc    Soft delete a sale (Admin only)
// @route   DELETE /api/v1/sales/:id
// @access  Private (Admin role)
export const deleteSale = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Format ID Penjualan tidak valid.' });
    }

    // Security check: Ensure only Admin can perform this soft delete
    if (!req.user || !req.user.roles || !req.user.roles.includes(Roles.admin)) {
       return res.status(403).json({ message: 'Anda tidak memiliki izin untuk menghapus penjualan ini.' });
    }

    const sale = await Sale.findByIdAndUpdate(
      id,
      { isDeleted: true, deletedAt: new Date(), deletedBy: req.user._id },
      { new: true }
    );

    if (!sale) {
      return res.status(404).json({ message: 'Penjualan tidak ditemukan.' });
    }

    res.status(200).json({
      message: 'Penjualan berhasil dihapus (soft delete).',
      sale: sale.toJSON()
    });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
        return res.status(400).json({ message: 'Format ID Penjualan tidak valid.' });
    }
    console.error('Kesalahan saat menghapus penjualan:', error);
    res.status(500).json({ message: 'Kesalahan server saat menghapus penjualan.', error: error.message });
  }
};
