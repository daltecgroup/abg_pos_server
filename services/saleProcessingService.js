import mongoose from 'mongoose';
import Outlet from '../models/Outlet.js';
import User from '../models/User.js';
import Menu from '../models/Menu.js';
import Addon from '../models/Addon.js';
import Bundle from '../models/Bundle.js';
import Ingredient from '../models/Ingredient.js';
import { PaymentMethods } from '../constants/paymentMethods.js';
import { Roles } from '../constants/roles.js';

// Helper to validate User references (moved here from controller as it's a utility for data processing)
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

/**
 * Processes raw sale data, performs validation, calculates total price,
 * aggregates ingredient usage, and prepares a structured sale object.
 * @param {object} rawSaleData - The raw request body from the client.
 * @param {object} reqUser - The authenticated user object from `req.user`.
 * @param {string|null} paymentEvidenceUrl - The URL of the uploaded payment evidence, if any.
 * @returns {Promise<{ saleData: object|null, errors: string[] }>} An object containing the prepared sale data and any validation errors.
 */
export const processNewSaleData = async (rawSaleData, reqUser, paymentEvidenceUrl) => {
    const { outletId, itemSingle, itemBundle, itemPromo, totalPaid: rawTotalPaid, payment } = rawSaleData;
    const errors = [];
    let calculatedTotalPrice = 0;
    const ingredientsConsumedMap = new Map(); // To aggregate ingredient usage (ingredientId -> {qty, expense, name, unit})

    let totalPaid = rawTotalPaid; // Use local variable for potential type conversion

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
    if (!reqUser || !reqUser._id || !reqUser.name) {
      errors.push('Informasi operator tidak tersedia. Pastikan pengguna terautentikasi.');
    } else {
      const user = await validateUserReference(reqUser._id, errors, 'operator', Roles.operator);
      if (user) {
        operatorSnapshot = { operatorId: user.userId, name: user.name };
      }
    }

    // --- Helper for adding ingredients to map ---
    const addIngredientsToMap = async (recipeItems, multiplier = 1) => {
        if (!recipeItems || !Array.isArray(recipeItems)) return;
        for (const recipeIngredient of recipeItems) {
            if (!recipeIngredient.ingredientId || recipeIngredient.qty === undefined || recipeIngredient.qty < 0) continue;
            const ingredient = await Ingredient.findById(recipeIngredient.ingredientId);
            if (!ingredient || ingredient.isDeleted || !ingredient.isActive) {
                // If ingredient is invalid/deleted, don't include it in consumption, but also don't block sale
                console.warn(`Ingredient ${recipeIngredient.ingredientId} for recipe not found or inactive. Skipping consumption calculation.`);
                continue;
            }

            const consumedQty = multiplier * recipeIngredient.qty;
            const consumedExpense = consumedQty * ingredient.price;

            const current = ingredientsConsumedMap.get(recipeIngredient.ingredientId.toString()) || { qty: 0, expense: 0, name: ingredient.name, unit: ingredient.unit };
            ingredientsConsumedMap.set(recipeIngredient.ingredientId.toString(), {
              ingredientId: ingredient._id,
              name: current.name,
              qty: current.qty + consumedQty,
              expense: current.expense + consumedExpense,
              unit: current.unit
            });
        }
    };


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

            // Add addon ingredients to ingredientsConsumedMap
            await addIngredientsToMap(addon.recipe, addonItem.qty);
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

        // Add menu ingredients to ingredientsConsumedMap
        await addIngredientsToMap(menu.recipe, item.qty);
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

                // Add chosen menu ingredients from bundle to ingredientsConsumedMap
                // Crucial: Multiply by bundleItem.qty AND chosenMenuItem.qty
                await addIngredientsToMap(chosenMenu.recipe, bundleItem.qty * chosenMenuItem.qty);
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
        await addIngredientsToMap(menu.recipe, promoItem.qty);
      }
    }

    // --- Validate Payment ---
    if (!payment || !payment.method || !Object.values(PaymentMethods).includes(payment.method)) {
      errors.push('Metode pembayaran tidak valid.');
    }
    // Check if evidence is required
    if (payment.method !== PaymentMethods.CASH && !paymentEvidenceUrl) {
      errors.push('Bukti pembayaran diperlukan untuk metode pembayaran non-tunai (Transfer, QRIS).');
    }
    // Update payment object with evidenceUrl
    payment.evidenceUrl = paymentEvidenceUrl;

    // --- Validate totalPaid ---
    if (typeof totalPaid === 'string') {
        const parsedTotalPaid = parseFloat(totalPaid);
        if (isNaN(parsedTotalPaid)) {
            errors.push('Jumlah dibayar ("totalPaid") harus berupa angka yang valid.');
        } else {
            totalPaid = parsedTotalPaid;
        }
    }

    if (totalPaid === undefined || typeof totalPaid !== 'number' || totalPaid < 0) {
      errors.push('Jumlah dibayar ("totalPaid") diperlukan dan harus berupa angka non-negatif.');
    }
    if (totalPaid < calculatedTotalPrice) {
      errors.push(`Jumlah dibayar (${totalPaid}) kurang dari total harga (${calculatedTotalPrice}).`);
    }

    if (errors.length > 0) {
        return { saleData: null, errors };
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
      ingredientUsed: finalIngredientUsed,
    };

    return { saleData, errors: [] };
};
