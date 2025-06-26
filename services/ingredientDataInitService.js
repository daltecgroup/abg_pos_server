// services/ingredientDataInitService.js

import fs from 'fs/promises';
import path from 'path';
import Ingredient from '../models/Ingredient.js'; // Adjust path as necessary
import { fileURLToPath } from 'url';
import mongoose from 'mongoose'; // Import mongoose to access the Counter model
import * as XLSX from 'xlsx'; // Import xlsx library

// Get the equivalent of __dirname in ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Clears all ingredients from the collection and resets the ingredient code counter.
 * This operation is destructive and should be used with caution, typically only in development/testing.
 * @returns {Promise<{ success: boolean, message: string, deletedCount: number }>}
 */
export const deleteAllIngredients = async () => {
    try {
        const IngredientModel = mongoose.models.Ingredient || mongoose.model('Ingredient');
        const CounterModel = mongoose.models.Counter || mongoose.model('Counter');

        const deleteResult = await IngredientModel.deleteMany({});
        const deletedCount = deleteResult.deletedCount;

        // Reset the ingredientCode counter
        await CounterModel.findOneAndUpdate(
            { _id: 'ingredientCode' },
            { seq: 0 },
            { upsert: true } // Creates if not exists, updates if it does
        );

        return {
            success: true,
            message: `Successfully deleted ${deletedCount} ingredients and reset the ingredient code counter.`,
            deletedCount: deletedCount
        };
    } catch (error) {
        console.error('Error deleting all ingredients:', error);
        return {
            success: false,
            message: `Failed to delete all ingredients: ${error.message}`,
            deletedCount: 0
        };
    }
};

/**
 * Helper function to parse XLSX content into an array of ingredient objects.
 * Assumes the first sheet contains the data.
 * Expected columns: name,unit,price,isActive (case-insensitive, order flexible)
 * @param {Buffer} fileBuffer - The buffer of the XLSX file.
 * @returns {Array<object>} - An array of parsed ingredient objects.
 */
const parseXlsxIngredients = (fileBuffer) => {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(worksheet);

    const ingredients = [];
    for (const row of json) {
        const ingredient = {};
        // Map XLSX column names (case-insensitive) to ingredient properties
        for (const key in row) {
            const lowerCaseKey = key.toLowerCase().trim();
            switch (lowerCaseKey) {
                case 'name':
                    ingredient.name = row[key];
                    break;
                case 'unit':
                    ingredient.unit = row[key];
                    break;
                case 'price':
                    ingredient.price = parseFloat(row[key]);
                    break;
                case 'isactive':
                    // Handle boolean values (e.g., "TRUE", "FALSE", 1, 0)
                    if (typeof row[key] === 'string') {
                        ingredient.isActive = row[key].toLowerCase() === 'true';
                    } else if (typeof row[key] === 'number') {
                        ingredient.isActive = row[key] === 1;
                    } else {
                        ingredient.isActive = Boolean(row[key]); // Default boolean conversion
                    }
                    break;
                default:
                    // Ignore unknown columns
                    break;
            }
        }
        ingredients.push(ingredient);
    }
    return ingredients;
};

/**
 * Initiates ingredient collection from an XLSX file.
 * It reads the XLSX file buffer, parses it, and for each ingredient, checks if it already exists
 * by name (case-insensitive). If not, it creates a new ingredient.
 * If an ingredient exists but its price is different, it updates the price.
 * @param {string} filePath - The absolute path to the XLSX file (from multer upload).
 * @returns {Promise<{ success: boolean, message: string, stats: { created: number, skipped: number, errors: number, details: Array<object> } }>}
 */
export const initializeIngredientsFromXlsx = async (filePath) => {
    const stats = {
        created: 0,
        skipped: 0,
        updated: 0, // NEW: Added updated counter
        errors: 0,
        details: []
    };

    try {
        const fileBuffer = await fs.readFile(filePath); // Read as buffer for XLSX
        const ingredientsData = parseXlsxIngredients(fileBuffer);

        if (!Array.isArray(ingredientsData)) {
            throw new Error('Parsed XLSX data is not an array of ingredient objects.');
        }

        for (const item of ingredientsData) {
            try {
                // Basic validation for required fields
                if (!item.name || typeof item.name !== 'string' || item.name.trim() === '') {
                    stats.errors++;
                    stats.details.push({ item: item.name || 'Unnamed', status: 'Error', reason: 'Name is missing or invalid.' });
                    continue;
                }
                if (!item.unit || typeof item.unit !== 'string' || !['weight', 'volume', 'pcs'].includes(item.unit.toLowerCase())) {
                     stats.errors++;
                    stats.details.push({ item: item.name, status: 'Error', reason: 'Unit is missing or invalid (must be "weight", "volume", or "pcs").' });
                    continue;
                }
                if (item.price === undefined || typeof item.price !== 'number' || item.price < 0) {
                     stats.errors++;
                    stats.details.push({ item: item.name, status: 'Error', reason: 'Price is missing or invalid (must be non-negative number).' });
                    continue;
                }
                // isActive is optional and defaults to true in schema, so no strict validation here.

                // Check if ingredient already exists by name (case-insensitive)
                const existingIngredient = await Ingredient.findOne({
                    name: new RegExp(`^${item.name}$`, 'i'), // Case-insensitive exact match
                    isDeleted: false // Only check non-deleted ingredients
                });

                if (existingIngredient) {
                    // NEW: Check if price needs to be updated
                    if (existingIngredient.price !== item.price) {
                        await Ingredient.findByIdAndUpdate(
                            existingIngredient._id,
                            { price: item.price, updatedAt: new Date() }, // Update price and timestamp
                            { new: true, runValidators: true }
                        );
                        stats.updated++;
                        stats.details.push({ item: existingIngredient.name, code: existingIngredient.code, status: 'Updated', oldPrice: existingIngredient.price, newPrice: item.price });
                    } else {
                        stats.skipped++;
                        stats.details.push({ item: existingIngredient.name, code: existingIngredient.code, status: 'Skipped', reason: 'Ingredient with this name already exists and price is the same.' });
                    }
                } else {
                    const newIngredient = await Ingredient.create({
                        name: item.name.trim(),
                        unit: item.unit.toLowerCase(),
                        price: item.price,
                        isActive: item.isActive !== undefined ? item.isActive : true, // Default to true
                        // code will be auto-generated by the model's pre-save hook
                    });
                    stats.created++;
                    stats.details.push({ item: newIngredient.name, code: newIngredient.code, status: 'Created' });
                }
            } catch (itemError) {
                stats.errors++;
                stats.details.push({ item: item.name || 'Unknown', status: 'Error', reason: itemError.message });
                console.error(`Error processing ingredient ${item.name}:`, itemError);
            }
        }

        return {
            success: true,
            message: 'Ingredient data initialization from XLSX complete.',
            stats: stats
        };

    } catch (error) {
        console.error('Error during ingredient data initialization from XLSX:', error);
        return {
            success: false,
            message: `Failed to initialize ingredient data from XLSX: ${error.message}`,
            stats: stats // Return partial stats even on overall failure
        };
    }
};
