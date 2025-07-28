import DailyOutletSaleReport from '../models/DailyOutletSaleReport.js';
import Outlet from '../models/Outlet.js'; // To get outlet code for report ID
import Menu from '../models/Menu.js'; // For fetching menu details if needed for name/price
import Addon from '../models/Addon.js'; // For fetching addon details if needed for name/price
import Bundle from '../models/Bundle.js'; // For fetching bundle details if needed for name/price
import mongoose from 'mongoose';

/**
 * Updates or creates a DailyOutletSaleReport based on a new Sale document.
 * This function aggregates items, total revenue, total expense, and sale count for a given outlet and date.
 *
 * @param {object} saleDocument - The Mongoose Sale document that was just created.
 * @returns {Promise<boolean>} True if the report was successfully updated/created, false otherwise.
 */
export const updateDailySaleReport = async (saleDocument) => {
  try {
    const outletId = saleDocument.outlet.outletId;
    const saleDate = new Date(saleDocument.createdAt);
    // Format date to YYMMDD for the report ID
    const formattedDate = `${String(saleDate.getFullYear()).slice(-2)}${String(saleDate.getMonth() + 1).padStart(2, '0')}${String(saleDate.getDate()).padStart(2, '0')}`;

    // Get the start of the day for the date field
    const startOfDay = new Date(saleDate.setUTCHours(0, 0, 0, 0));

    // Fetch outlet details to get its code for the report _id
    const outlet = await Outlet.findById(outletId).select('code name');
    if (!outlet || !outlet.code) {
      console.error(`Outlet ${outletId} not found or missing code. Cannot create daily sale report.`);
      return false;
    }
    const outletCodeSuffix = outlet.code.length <= 3 ? outlet.code.toUpperCase() : outlet.code.slice(-3).toUpperCase();

    // Construct the unique report ID
    const reportId = `${outletId.toString()}_${formattedDate}`;

    // Find or create the daily report
    let dailyReport = await DailyOutletSaleReport.findById(reportId);

    // Map to aggregate items sold (key: itemId_type, value: {qtySold, totalRevenue, name, type})
    const aggregatedItemsMap = new Map();

    // If report exists, initialize map with existing items
    if (dailyReport) {
      dailyReport.itemSold.forEach(item => {
        aggregatedItemsMap.set(`${item.itemId.toString()}_${item.type}`, {
          itemId: item.itemId,
          name: item.name,
          qtySold: item.qtySold,
          totalRevenue: item.totalRevenue,
          type: item.type,
        });
      });
    } else {
      // If creating a new report, set initial outlet snapshot
      dailyReport = new DailyOutletSaleReport({
        _id: reportId,
        outlet: {
          outletId: outlet._id,
          name: outlet.name,
          code: outlet.code,
        },
        date: startOfDay,
        itemSold: [],
        totalSale: 0,
        totalExpense: 0,
        saleComplete: 0, // Initialize new field
      });
    }

    // Aggregate items from the current sale
    saleDocument.itemSingle.forEach(item => {
      const key = `${item.menuId.toString()}_menu_single`;
      const current = aggregatedItemsMap.get(key) || { itemId: item.menuId, name: item.name, qtySold: 0, totalRevenue: 0, type: 'menu_single' };
      current.qtySold += item.qty;
      current.totalRevenue += item.qty * item.price * (1 - item.discount / 100);
      aggregatedItemsMap.set(key, current);

      // Aggregate addons within single items
      item.addons.forEach(addon => {
        const addonKey = `${addon.addonId.toString()}_addon`;
        const currentAddon = aggregatedItemsMap.get(addonKey) || { itemId: addon.addonId, name: addon.name, qtySold: 0, totalRevenue: 0, type: 'addon' };
        currentAddon.qtySold += addon.qty;
        currentAddon.totalRevenue += addon.qty * addon.price;
        aggregatedItemsMap.set(addonKey, currentAddon);
      });
    });

    saleDocument.itemBundle.forEach(bundleItem => {
      const key = `${bundleItem.menuBundleId.toString()}_bundle`;
      const current = aggregatedItemsMap.get(key) || { itemId: bundleItem.menuBundleId, name: bundleItem.name, qtySold: 0, totalRevenue: 0, type: 'bundle' };
      current.qtySold += bundleItem.qty;
      current.totalRevenue += bundleItem.qty * bundleItem.price;
      aggregatedItemsMap.set(key, current);

      // Aggregate individual menus within bundles (optional, if you want to see individual menu sales from bundles)
      // For now, we'll just count the bundle itself as a sold item.
      // If you need individual menu tracking from bundles, you'd iterate bundleItem.items here.
    });

    saleDocument.itemPromo.forEach(promoItem => {
      const key = `${promoItem.menuId.toString()}_menu_promo`;
      const current = aggregatedItemsMap.get(key) || { itemId: promoItem.menuId, name: promoItem.name, qtySold: 0, totalRevenue: 0, type: 'menu_promo' };
      current.qtySold += promoItem.qty;
      // Promo items contribute 0 revenue to totalSale, but are tracked in itemSold
      current.totalRevenue += 0;
      aggregatedItemsMap.set(key, current);
    });

    // Calculate total expense for the current sale
    let currentSaleExpense = 0;
    if (saleDocument.ingredientUsed && Array.isArray(saleDocument.ingredientUsed)) {
        currentSaleExpense = saleDocument.ingredientUsed.reduce((sum, ing) => sum + ing.expense, 0);
    }

    // Update the daily report's itemSold array, totalSale, totalExpense, and saleComplete
    dailyReport.itemSold = Array.from(aggregatedItemsMap.values());
    dailyReport.totalSale += saleDocument.totalPrice; // Add the total price of the new sale
    dailyReport.totalExpense += currentSaleExpense; // Add the total expense of the new sale
    dailyReport.saleComplete += 1; // Increment sale count for this day and outlet

    await dailyReport.save();
    console.log(`DailyOutletSaleReport for ${reportId} updated successfully.`);
    return true;

  } catch (error) {
    console.error(`Error updating DailyOutletSaleReport for sale ${saleDocument.code}:`, error);
    return false;
  }
};
