// services/outletInventoryService.js

import OutletInventory from '../models/OutletInventory.js';
import OutletInventoryTransaction from '../models/OutletInventoryTransaction.js';
import Ingredient from '../models/Ingredient.js';
import Outlet from '../models/Outlet.js'; // Import Outlet model for recalculation
import { TransactionTypes } from '../constants/transactionTypes.js';
import mongoose from 'mongoose';

/**
 * Syncs the OutletInventory based on a single OutletInventoryTransaction.
 * This function will be called when an OIT is created or its 'isValid' status changes.
 * It's responsible for updating the `currentQty` in the main OutletInventory document.
 * @param {object} transaction The OutletInventoryTransaction document (or object with necessary fields)
 * @param {object} userContext The user who initiated the action (e.g., { userId: ..., userName: ... })
 * @returns {Promise<boolean>} True if successful, false otherwise.
 */
export const syncOutletInventory = async (transaction, userContext) => {
    // Ensure transaction is a Mongoose document or has toObject method
    const trxObject = transaction.toObject ? transaction.toObject() : transaction;

    try {
        const { _id: transactionId, outlet, ingredient, qty, isValid } = trxObject;

        // Fetch current ingredient details to get latest name, unit, price for snapshot
        const currentIngredientDetails = await Ingredient.findById(ingredient.ingredientId);

        if (!currentIngredientDetails || currentIngredientDetails.isDeleted || !currentIngredientDetails.isActive) {
            console.error(`Ingredient ${ingredient.ingredientId} not found or inactive for OIT ${transactionId}. Cannot sync inventory.`);
            return false;
        }

        // Determine the actual quantity change for inventory
        // OIT's qty is already signed by its pre-save hook: IN is positive, OUT/SPOILAGE are negative
        let quantityChange = qty;

        // If the transaction is being invalidated, reverse its effect
        if (isValid === false) {
            quantityChange = -qty; // Reverse the original quantity
        }

        // Find the OutletInventory document for this outlet
        let outletInventory = await OutletInventory.findById(outlet.outletId);

        const ingredientUpdate = {
            ingredientId: ingredient.ingredientId,
            name: currentIngredientDetails.name,
            unit: currentIngredientDetails.unit,
            price: currentIngredientDetails.price,
            lastQuantityUpdated: new Date()
        };

        const syncMetadata = {
            lastSyncedAt: new Date(),
            'lastSyncedBy.userId': userContext.userId || null,
            'lastSyncedBy.userName': userContext.userName || 'System',
        };

        if (outletInventory) {
            // OutletInventory document exists. Now check if the ingredient exists in its array.
            const existingIngredientIndex = outletInventory.ingredients.findIndex(
                item => item.ingredientId.toString() === ingredient.ingredientId.toString()
            );

            if (existingIngredientIndex !== -1) {
                // Ingredient found in the array, update its quantity and snapshots
                ingredientUpdate.currentQty = outletInventory.ingredients[existingIngredientIndex].currentQty + quantityChange;

                const updateOperation = {
                    $set: {
                        [`ingredients.${existingIngredientIndex}`]: ingredientUpdate,
                        ...syncMetadata // Update last synced time for the document
                    }
                };

                // Use findByIdAndUpdate on the main document
                await OutletInventory.findByIdAndUpdate(
                    outlet.outletId,
                    updateOperation,
                    { new: true, runValidators: true }
                );
            } else {
                // Ingredient not found in the array, add it
                ingredientUpdate.currentQty = quantityChange; // Initial quantity for new ingredient

                const updateOperation = {
                    $addToSet: {
                        ingredients: ingredientUpdate
                    },
                    $set: syncMetadata // Update last synced time for the document
                };

                await OutletInventory.findByIdAndUpdate(
                    outlet.outletId,
                    updateOperation,
                    { new: true, runValidators: true }
                );
            }
        } else {
            // OutletInventory document does not exist, create it with the first ingredient
            ingredientUpdate.currentQty = quantityChange; // Initial quantity

            await OutletInventory.create({
                _id: outlet.outletId, // Set _id to outletId
                ingredients: [ingredientUpdate],
                ...syncMetadata
            });
        }

        // Mark the OutletInventoryTransaction as calculated
        await OutletInventoryTransaction.findByIdAndUpdate(
            transactionId,
            { isValid: isValid, isCalculated: true, calculatedAt: new Date() },
            { new: true }
        );

        return true;

    } catch (error) {
        console.error(`Error syncing OutletInventory for transaction ${transaction._id}:`, error);
        return false;
    }
};

/**
 * Reverses the effect of an OutletInventoryTransaction on the OutletInventory.
 * This is typically called when an OIT is soft-deleted or marked isValid=false.
 * @param {object} transaction The OutletInventoryTransaction document to reverse
 * @param {object} userContext The user who initiated the reversal
 * @returns {Promise<boolean>} True if successful, false otherwise.
 */
export const reverseOutletInventorySync = async (transaction, userContext) => {
    const trxObject = transaction.toObject ? transaction.toObject() : transaction;

    try {
        const { _id: transactionId, outlet, ingredient, qty, isValid } = trxObject;

        // Revert the quantity change
        let quantityChangeToReverse = -qty; // Opposite of the original signed quantity

        // Find the OutletInventory document
        let outletInventory = await OutletInventory.findById(outlet.outletId);

        if (!outletInventory) {
            console.warn(`OutletInventory for outlet ${outlet.outletId} not found during reversal of OIT ${transactionId}.`);
            return false; // Cannot reverse if the inventory record doesn't exist
        }

        const existingIngredientIndex = outletInventory.ingredients.findIndex(
            item => item.ingredientId.toString() === ingredient.ingredientId.toString()
        );

        if (existingIngredientIndex === -1) {
            console.warn(`Ingredient ${ingredient.ingredientId} not found in OutletInventory for outlet ${outlet.outletId} during reversal of OIT ${transactionId}.`);
            return false; // Cannot reverse if the ingredient is not in the array
        }

        const currentQty = outletInventory.ingredients[existingIngredientIndex].currentQty;
        const newQty = currentQty + quantityChangeToReverse; // Apply the reversed change

        // Construct the update object for the specific array element
        const updateOperation = {
            $set: {
                [`ingredients.${existingIngredientIndex}.currentQty`]: newQty,
                [`ingredients.${existingIngredientIndex}.lastQuantityUpdated`]: new Date(),
                lastSyncedAt: new Date(),
                'lastSyncedBy.userId': userContext.userId || null,
                'lastSyncedBy.userName': userContext.userName || 'System (Reversal)',
            }
        };

        // Perform the update
        await OutletInventory.findByIdAndUpdate(
            outlet.outletId,
            updateOperation,
            { new: true, runValidators: true }
        );

        // Mark the OutletInventoryTransaction as NOT calculated if being invalidated or deleted
        await OutletInventoryTransaction.findByIdAndUpdate(
            transactionId,
            { isCalculated: false, calculatedAt: null, isValid: isValid },
            { new: true }
        );

        return true;

    } catch (error) {
        console.error(`Error reversing OutletInventory sync for transaction ${transaction._id}:`, error);
        return false;
    }
};

/**
 * Recalculates all OutletInventory documents based on all valid, undeleted
 * OutletInventoryTransactions. This provides a "source of truth" rebuild
 * and marks all processed transactions as calculated.
 */
export const recalculateAllOutletInventories = async () => {
    console.log('Starting full recalculation of all Outlet Inventories...');
    try {
        const allOutlets = await Outlet.find({ isDeleted: false, isActive: true }).select('_id name');

        if (allOutlets.length === 0) {
            console.log('No active outlets found for recalculation.');
            return;
        }

        const userContext = {userName: 'Automated Recalculation' };

        for (const outlet of allOutlets) {
            console.log(`Recalculating inventory for Outlet: ${outlet.name} (ID: ${outlet._id})...`);

            // Find all valid, non-deleted transactions for this outlet
            const outletTransactions = await OutletInventoryTransaction.find({
                'outlet.outletId': outlet._id,
                isValid: true,
                isDeleted: false
            }).sort({ createdAt: 1 }); // Process in chronological order

            const ingredientAggregates = new Map(); // Map: ingredientId -> { currentQty, name, unit, price }

            for (const trx of outletTransactions) {
                const ingredientIdStr = trx.ingredient.ingredientId.toString();
                const currentQty = ingredientAggregates.get(ingredientIdStr)?.currentQty || 0;
                const newQty = currentQty + trx.qty; // trx.qty is already signed

                // Fetch latest ingredient details for snapshot consistency
                const latestIngredient = await Ingredient.findById(trx.ingredient.ingredientId);

                ingredientAggregates.set(ingredientIdStr, {
                    ingredientId: trx.ingredient.ingredientId,
                    currentQty: newQty,
                    name: latestIngredient ? latestIngredient.name : trx.ingredient.name, // Use latest name or transaction snapshot
                    unit: latestIngredient ? latestIngredient.unit : trx.ingredient.unit, // Use latest unit or transaction snapshot
                    price: latestIngredient ? latestIngredient.price : trx.price, // Use latest price or transaction snapshot
                    lastQuantityUpdated: new Date()
                });

                // Mark this transaction as calculated
                await OutletInventoryTransaction.findByIdAndUpdate(
                    trx._id,
                    { isCalculated: true, calculatedAt: new Date(), isValid: true },
                    { new: true }
                );
            }

            // Convert map to array for Mongoose document
            const newIngredientsArray = Array.from(ingredientAggregates.values());

            // Update or create the OutletInventory document for this outlet
            await OutletInventory.findOneAndUpdate(
                { _id: outlet._id },
                {
                    $set: {
                        ingredients: newIngredientsArray,
                        lastSyncedAt: new Date(),
                        'lastSyncedBy.userId': userContext.userId,
                        'lastSyncedBy.userName': userContext.userName,
                    },
                },
                { upsert: true, new: true, runValidators: true }
            );

            console.log(`Recalculation complete for Outlet: ${outlet.name}.`);
        }
        console.log('Full recalculation of all Outlet Inventories finished.');

    } catch (error) {
        console.error('Error during full recalculation of Outlet Inventories:', error);
    }
};


/**
 * Periodically processes uncalculated and valid OutletInventoryTransactions
 * to update the OutletInventory.
 * This function should ideally be called from the application's entry point (e.g., server.js)
 * to ensure it runs as part of the application lifecycle.
 */
export const processUncalculatedTransactions = async () => {
    console.log('Starting periodic processing of uncalculated inventory transactions (incremental sync)...');
    try {
        const uncalculatedTransactions = await OutletInventoryTransaction.find({
            isValid: true,
            isCalculated: false,
            isDeleted: false // Only process active, non-deleted transactions
        });

        if (uncalculatedTransactions.length === 0) {
            console.log('No uncalculated transactions found for incremental sync.');
            return;
        }

        console.log(`Found ${uncalculatedTransactions.length} uncalculated transactions for incremental sync.`);

        const userContext = {userName: 'Automated Sync' };

        for (const transaction of uncalculatedTransactions) {
            // Re-call syncOutletInventory for each transaction
            // The syncOutletInventory function itself will mark the OIT as isCalculated: true
            const success = await syncOutletInventory(transaction, userContext);
            if (success) {
                console.log(`Successfully processed (incremental) transaction: ${transaction._id}`);
            } else {
                console.error(`Failed to process (incremental) transaction: ${transaction._id}`);
            }
        }
        console.log('Finished periodic processing of uncalculated inventory transactions (incremental sync).');

    } catch (error) {
        console.error('Error during periodic incremental transaction processing:', error);
    }
};


// Schedule the periodic task for full recalculation
const RECALCULATION_INTERVAL_MS = 10 * 1000; // 10 seconds for testing
// setInterval(recalculateAllOutletInventories, RECALCULATION_INTERVAL_MS);

// Optionally, run full recalculation once immediately on startup
// recalculateAllOutletInventories();

// Keep the incremental sync running, perhaps at a different interval if desired
// const INCREMENTAL_SYNC_INTERVAL_MS = 1 * 60 * 1000; // e.g., every 1 minute
// setInterval(processUncalculatedTransactions, INCREMENTAL_SYNC_INTERVAL_MS);
// processUncalculatedTransactions(); // Run once immediately for incremental sync
