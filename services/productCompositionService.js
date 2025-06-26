import mongoose from 'mongoose';
import Ingredient from '../models/Ingredient.js'; // Assuming this path to your Ingredient model
import MenuCategory from '../models/MenuCategory.js'; // Assuming this path to your MenuCategory model

/**
 * Validates and processes an array of recipe items (ingredients and their quantities).
 * Checks for valid ObjectId, existence, and active status of each ingredient.
 * @param {Array<object>} recipeItemsArray - The array of recipe items (e.g., [{ ingredientId: '...', qty: 1 }])
 * @param {Array<string>} errorsArray - An array to push validation error messages into.
 * @returns {Promise<Array<object>|null>} A processed array of recipe items if valid, or null if errors occur.
 */
export const validateRecipeArray = async (recipeItemsArray, errorsArray) => {
    if (!Array.isArray(recipeItemsArray)) {
        errorsArray.push('Resep harus berupa array.');
        return null;
    }

    const processedRecipe = [];
    for (let i = 0; i < recipeItemsArray.length; i++) {
        const item = recipeItemsArray[i];
        if (!item.ingredientId || !mongoose.Types.ObjectId.isValid(item.ingredientId)) {
            errorsArray.push(`Resep di indeks ${i} memiliki ID bahan tidak valid.`);
            continue;
        }
        const existingIngredient = await Ingredient.findById(item.ingredientId);
        if (!existingIngredient || existingIngredient.isDeleted || !existingIngredient.isActive) {
            errorsArray.push(`Bahan dengan ID '${item.ingredientId}' di indeks resep ${i} tidak ditemukan, sudah dihapus, atau tidak aktif.`);
        }
        if (item.qty === undefined || typeof item.qty !== 'number' || item.qty < 0) {
            errorsArray.push(`Jumlah bahan di indeks resep ${i} diperlukan dan harus berupa angka non-negatif.`);
        }
        processedRecipe.push({
            ingredientId: item.ingredientId,
            qty: item.qty
        });
    }
    return processedRecipe;
};

/**
 * Validates and processes an array of bundle category items (menu category IDs and quantities).
 * Checks for valid ObjectId, existence, and active status of each menu category.
 * @param {Array<object>} categoriesArray - The array of bundle category items (e.g., [{ menuCategoryId: '...', qty: 1 }])
 * @param {Array<string>} errorsArray - An array to push validation error messages into.
 * @returns {Promise<Array<object>|null>} A processed array of categories if valid, or null if errors occur.
 */
export const validateBundleCategoriesArray = async (categoriesArray, errorsArray) => {
    if (!Array.isArray(categoriesArray) || categoriesArray.length === 0) {
        errorsArray.push('Kategori paket diperlukan dan harus berupa array dengan setidaknya satu item.');
        return null;
    }

    const processedCategories = [];
    for (let i = 0; i < categoriesArray.length; i++) {
        const item = categoriesArray[i];
        if (!item.menuCategoryId || !mongoose.Types.ObjectId.isValid(item.menuCategoryId)) {
            errorsArray.push(`Kategori di indeks ${i} memiliki ID kategori menu tidak valid.`);
            continue;
        }
        const existingCategory = await MenuCategory.findById(item.menuCategoryId);
        if (!existingCategory || existingCategory.isDeleted || !existingCategory.isActive) {
            errorsArray.push(`ID Kategori Menu '${item.menuCategoryId}' di indeks ${i} tidak ditemukan, sudah dihapus, atau tidak aktif.`);
        }
        if (item.qty === undefined || typeof item.qty !== 'number' || item.qty < 1) {
            errorsArray.push(`Jumlah untuk kategori di indeks ${i} diperlukan dan harus berupa angka positif (minimal 1).`);
        }
        processedCategories.push({
            menuCategoryId: item.menuCategoryId,
            qty: item.qty
        });
    }
    return processedCategories;
};
