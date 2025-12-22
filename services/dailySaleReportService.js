import DailyOutletSaleReport from '../models/DailyOutletSaleReport.js';
import Outlet from '../models/Outlet.js';
import mongoose from 'mongoose';

/**
 * Updates or creates a DailyOutletSaleReport based on a new Sale document.
 */
export const updateDailySaleReport = async (saleDocument) => {
  // --- PERBAIKAN PENTING DI SINI ---
  // Jika sale ditandai terhapus, JANGAN dijalankan update (penambahan) lagi.
  if (saleDocument.isDeleted) {
    console.log(`[SKIP UPDATE] Sale ${saleDocument.code} berstatus deleted. Skip penambahan laporan.`);
    return true; 
  }
  // ---------------------------------

  try {
    const outletId = saleDocument.outlet.outletId;
    const saleDate = new Date(saleDocument.createdAt);
    // Format date to YYMMDD for the report ID
    const formattedDate = `${String(saleDate.getFullYear()).slice(-2)}${String(saleDate.getMonth() + 1).padStart(2, '0')}${String(saleDate.getDate()).padStart(2, '0')}`;
    const startOfDay = new Date(saleDate.setUTCHours(0, 0, 0, 0));

    const outlet = await Outlet.findById(outletId).select('code name');
    if (!outlet || !outlet.code) return false;

    const reportId = `${outletId.toString()}_${formattedDate}`;
    let dailyReport = await DailyOutletSaleReport.findById(reportId);

    const aggregatedItemsMap = new Map();

    if (dailyReport) {
      dailyReport.itemSold.forEach(item => {
        aggregatedItemsMap.set(`${item.itemId.toString()}_${item.type}`, {
          itemId: item.itemId,
          name: item.name,
          qtySold: Number(item.qtySold),
          totalRevenue: Number(item.totalRevenue),
          type: item.type,
        });
      });
    } else {
      dailyReport = new DailyOutletSaleReport({
        _id: reportId,
        outlet: { outletId: outlet._id, name: outlet.name, code: outlet.code },
        date: startOfDay,
        itemSold: [],
        totalSale: 0,
        totalExpense: 0,
        saleComplete: 0,
      });
    }

    // --- AGGREGATION LOGIC ---
    if (saleDocument.itemSingle) {
        saleDocument.itemSingle.forEach(item => {
            const key = `${item.menuId.toString()}_menu_single`;
            const current = aggregatedItemsMap.get(key) || { itemId: item.menuId, name: item.name, qtySold: 0, totalRevenue: 0, type: 'menu_single' };
            current.qtySold += Number(item.qty);
            current.totalRevenue += Number(item.qty) * Number(item.price) * (1 - Number(item.discount) / 100);
            aggregatedItemsMap.set(key, current);

            if (item.addons) {
                item.addons.forEach(addon => {
                    const addonKey = `${addon.addonId.toString()}_addon`;
                    const currentAddon = aggregatedItemsMap.get(addonKey) || { itemId: addon.addonId, name: addon.name, qtySold: 0, totalRevenue: 0, type: 'addon' };
                    currentAddon.qtySold += Number(addon.qty);
                    currentAddon.totalRevenue += Number(addon.qty) * Number(addon.price);
                    aggregatedItemsMap.set(addonKey, currentAddon);
                });
            }
        });
    }

    if (saleDocument.itemBundle) {
        saleDocument.itemBundle.forEach(bundleItem => {
            const key = `${bundleItem.menuBundleId.toString()}_bundle`;
            const current = aggregatedItemsMap.get(key) || { itemId: bundleItem.menuBundleId, name: bundleItem.name, qtySold: 0, totalRevenue: 0, type: 'bundle' };
            current.qtySold += Number(bundleItem.qty);
            current.totalRevenue += Number(bundleItem.qty) * Number(bundleItem.price);
            aggregatedItemsMap.set(key, current);
        });
    }

    if (saleDocument.itemPromo) {
        saleDocument.itemPromo.forEach(promoItem => {
            const key = `${promoItem.menuId.toString()}_menu_promo`;
            const current = aggregatedItemsMap.get(key) || { itemId: promoItem.menuId, name: promoItem.name, qtySold: 0, totalRevenue: 0, type: 'menu_promo' };
            current.qtySold += Number(promoItem.qty);
            aggregatedItemsMap.set(key, current);
        });
    }

    let currentSaleExpense = 0;
    if (saleDocument.ingredientUsed && Array.isArray(saleDocument.ingredientUsed)) {
        currentSaleExpense = saleDocument.ingredientUsed.reduce((sum, ing) => sum + Number(ing.expense), 0);
    }

    // Apply Updates
    dailyReport.itemSold = Array.from(aggregatedItemsMap.values());
    dailyReport.totalSale = Number(dailyReport.totalSale) + Number(saleDocument.totalPrice);
    dailyReport.totalExpense = Number(dailyReport.totalExpense) + Number(currentSaleExpense);
    dailyReport.saleComplete = Number(dailyReport.saleComplete) + 1;

    // WAJIB: Mark Modified
    dailyReport.markModified('itemSold');
    
    await dailyReport.save();
    console.log(`[UPDATE REPORT] Sukses update ID: ${reportId}. Total Sale sekarang: ${dailyReport.totalSale}`);
    return true;

  } catch (error) {
    console.error(`Error updating DailyOutletSaleReport:`, error);
    return false;
  }
};

/**
 * REVERT (UNDO) Daily Sales Report
 * Fungsi ini KEBALIKAN dari update. Mengurangi angka.
 */
export const revertDailySaleReport = async (saleDocument) => {
  try {
    const outletId = saleDocument.outlet.outletId;
    const saleDate = new Date(saleDocument.createdAt);
    
    // Generate Report ID
    const formattedDate = `${String(saleDate.getFullYear()).slice(-2)}${String(saleDate.getMonth() + 1).padStart(2, '0')}${String(saleDate.getDate()).padStart(2, '0')}`;
    const reportId = `${outletId.toString()}_${formattedDate}`;

    console.log(`[REVERT REPORT] Mencari ID: ${reportId} untuk Sale: ${saleDocument.code} (Rp ${saleDocument.totalPrice})`);

    // Cari Laporan
    let dailyReport = await DailyOutletSaleReport.findById(reportId);

    if (!dailyReport) {
      console.warn(`[REVERT REPORT] GAGAL. Laporan dengan ID ${reportId} tidak ditemukan.`);
      return false;
    }

    // Simpan nilai awal untuk log
    const initialSale = dailyReport.totalSale;

    // Petakan Item Existing
    const aggregatedItemsMap = new Map();
    if (dailyReport.itemSold) {
      dailyReport.itemSold.forEach(item => {
        aggregatedItemsMap.set(`${item.itemId.toString()}_${item.type}`, {
          itemId: item.itemId,
          name: item.name,
          qtySold: Number(item.qtySold),
          totalRevenue: Number(item.totalRevenue),
          type: item.type,
        });
      });
    }

    // LOGIKA PENGURANGAN (REVERT)
    if (saleDocument.itemSingle) {
      saleDocument.itemSingle.forEach(item => {
        const key = `${item.menuId.toString()}_menu_single`;
        if (aggregatedItemsMap.has(key)) {
          const current = aggregatedItemsMap.get(key);
          current.qtySold -= Number(item.qty);
          
          const revenueToRemove = Number(item.qty) * Number(item.price) * (1 - Number(item.discount) / 100);
          current.totalRevenue -= revenueToRemove;
          
          if (current.qtySold < 0) current.qtySold = 0;
          if (current.totalRevenue < 0) current.totalRevenue = 0;
        }

        if (item.addons) {
          item.addons.forEach(addon => {
            const addonKey = `${addon.addonId.toString()}_addon`;
            if (aggregatedItemsMap.has(addonKey)) {
              const currentAddon = aggregatedItemsMap.get(addonKey);
              currentAddon.qtySold -= Number(addon.qty);
              currentAddon.totalRevenue -= (Number(addon.qty) * Number(addon.price));
              
              if (currentAddon.qtySold < 0) currentAddon.qtySold = 0;
            }
          });
        }
      });
    }

    if (saleDocument.itemBundle) {
      saleDocument.itemBundle.forEach(bundleItem => {
        const key = `${bundleItem.menuBundleId.toString()}_bundle`;
        if (aggregatedItemsMap.has(key)) {
          const current = aggregatedItemsMap.get(key);
          current.qtySold -= Number(bundleItem.qty);
          current.totalRevenue -= (Number(bundleItem.qty) * Number(bundleItem.price));
          
          if (current.qtySold < 0) current.qtySold = 0;
        }
      });
    }

    if (saleDocument.itemPromo) {
      saleDocument.itemPromo.forEach(promoItem => {
        const key = `${promoItem.menuId.toString()}_menu_promo`;
        if (aggregatedItemsMap.has(key)) {
          const current = aggregatedItemsMap.get(key);
          current.qtySold -= Number(promoItem.qty);
          if (current.qtySold < 0) current.qtySold = 0;
        }
      });
    }

    let currentSaleExpense = 0;
    if (saleDocument.ingredientUsed && Array.isArray(saleDocument.ingredientUsed)) {
        currentSaleExpense = saleDocument.ingredientUsed.reduce((sum, ing) => sum + Number(ing.expense), 0);
    }

    // Apply Changes ke Dokumen
    dailyReport.itemSold = Array.from(aggregatedItemsMap.values());
    dailyReport.totalSale = Number(dailyReport.totalSale) - Number(saleDocument.totalPrice);
    dailyReport.totalExpense = Number(dailyReport.totalExpense) - Number(currentSaleExpense);
    dailyReport.saleComplete = Number(dailyReport.saleComplete) - 1;

    // Safety Checks
    if (dailyReport.totalSale < 0) dailyReport.totalSale = 0;
    if (dailyReport.totalExpense < 0) dailyReport.totalExpense = 0;
    if (dailyReport.saleComplete < 0) dailyReport.saleComplete = 0;

    // === KUNCI KEBERHASILAN ===
    dailyReport.markModified('itemSold'); 
    dailyReport.markModified('totalSale');
    dailyReport.markModified('totalExpense');

    await dailyReport.save();

    console.log(`[REVERT REPORT] Sukses! ${initialSale} -> ${dailyReport.totalSale}`);
    return true;

  } catch (error) {
    console.error(`[REVERT REPORT ERROR] Sale Code: ${saleDocument.code}:`, error);
    return false;
  }
};