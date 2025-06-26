// controllers/dataInitController.js

import * as ingredientDataInitService from '../services/ingredientDataInitService.js';
import fs from 'fs/promises'; // Import fs/promises for file cleanup
import multer from 'multer'; // Import multer for error handling (though primary multer use is in routes)

/**
 * @desc    Clears all ingredients from the collection.
 * @route   DELETE /api/v1/data-init/ingredients/all
 * @access  Private (Admin role only)
 */
export const clearAllIngredients = async (req, res) => {
    try {
        const result = await ingredientDataInitService.deleteAllIngredients();

        if (result.success) {
            res.status(200).json({
                message: result.message,
                deletedCount: result.deletedCount,
            });
        } else {
            res.status(500).json({
                message: result.message,
                deletedCount: result.deletedCount,
            });
        }
    } catch (error) {
        console.error('Error in clearAllIngredients controller:', error);
        res.status(500).json({ message: 'Server error during ingredient clearing process.' });
    }
};

/**
 * @desc    Uploads an XLSX file and initiates ingredient data from it.
 * @route   POST /api/v1/data-init/upload-ingredients-xlsx
 * @access  Private (Admin role only)
 * @file    { file } ingredientsXlsxFile - The XLSX file containing ingredient data.
 */
export const uploadAndInitiateIngredientDataFromXlsx = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'XLSX file for ingredients is required.' });
        }

        const filePath = req.file.path; // Multer saves the file and provides the path

        const result = await ingredientDataInitService.initializeIngredientsFromXlsx(filePath);

        // After processing, delete the temporary file
        try {
            await fs.unlink(filePath);
            console.log(`Successfully deleted temporary XLSX file: ${filePath}`);
        } catch (fileError) {
            console.error(`Failed to delete temporary XLSX file ${filePath}:`, fileError);
            // Don't block the response, but log the error
        }

        if (result.success) {
            res.status(200).json({
                message: 'Ingredient data initialization from uploaded XLSX completed.',
                stats: result.stats,
            });
        } else {
            res.status(500).json({
                message: result.message,
                stats: result.stats,
            });
        }
    } catch (error) {
        // If an error occurs before or during service call, delete the file if it exists
        if (req.file && req.file.path) {
            try {
                await fs.unlink(req.file.path);
                console.log(`Successfully deleted temporary XLSX file on error: ${req.file.path}`);
            } catch (fileError) {
                console.error(`Failed to delete temporary XLSX file on error ${req.file.path}:`, fileError);
            }
        }

        console.error('Error in uploadAndInitiateIngredientDataFromXlsx controller:', error);
        // Handle Multer-specific errors
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ message: 'Ukuran file XLSX terlalu besar. Maksimal 5MB.' });
        }
        if (error.message.includes('Hanya file XLSX')) { // Custom error from fileFilter
            return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: 'Server error during uploaded XLSX data initiation process.' });
    }
};
