import DailyOutletSaleReport from '../models/DailyOutletSaleReport.js';
import Outlet from '../models/Outlet.js';
import Sale from '../models/Sale.js'; // Diperlukan untuk fitur Regenerate
import mongoose from 'mongoose';

// --- KONFIGURASI TIMEZONE ---
// Ganti dengan 'Asia/Jakarta' (WIB), 'Asia/Makassar' (WITA), atau 'Asia/Jayapura' (WIT)
// Sesuai dengan lokasi operasional outlet Anda.
const TIMEZONE = 'Asia/Makassar'; 

/**
 * Updates or creates a DailyOutletSaleReport based on a new Sale document.
 */
export const updateDailySaleReport = async (saleDocument) => {
  // 1. CEK STATUS DELETE: Jika sale sudah dihapus, jangan lakukan update (penambahan).
  if (saleDocument.isDeleted) {
    console.log(`[SKIP UPDATE] Sale ${saleDocument.code} berstatus deleted. Skip penambahan laporan.`);
    return true; 
  }

  try {
    const outletId = saleDocument.outlet.outletId;
    
    // --- 2. PERBAIKAN TIMEZONE ---
    // Konversi waktu UTC server ke Waktu Lokal Outlet sebelum menentukan tanggal laporan
    const utcDate = new Date(saleDocument.createdAt);
    const localDate = new Date(utcDate.toLocaleString("en-US", { timeZone: TIMEZONE }));
    
    const formattedDate = `${String(localDate.getFullYear()).slice(-2)}${String(localDate.getMonth() + 1).padStart(2, '0')}${String(localDate.getDate()).padStart(2, '0')}`;
    const startOfDay = new Date(localDate.setHours(0, 0, 0, 0)); // Start of day lokal

    const outlet = await Outlet.findById(outletId).select('code name');
    if (!outlet || !outlet.code) return false;

    const reportId = `${outletId.toString()}_${formattedDate}`;
    let dailyReport = await DailyOutletSaleReport.findById(reportId);

    const aggregatedItemsMap = new Map();

    // Load existing items from report
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

    // A. Item Single
    if (saleDocument.itemSingle) {
        saleDocument.itemSingle.forEach(item => {
            // Menu Utama
            const key = `${item.menuId.toString()}_menu_single`;
            const current = aggregatedItemsMap.get(key) || { itemId: item.menuId, name: item.name, qtySold: 0, totalRevenue: 0, type: 'menu_single' };
            current.qtySold += Number(item.qty);
            current.totalRevenue += Number(item.qty) * Number(item.price) * (1 - Number(item.discount) / 100);
            aggregatedItemsMap.set(key, current);

            // Addon pada Menu
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

    // B. Item Bundle
    if (saleDocument.itemBundle) {
        saleDocument.itemBundle.forEach(bundleItem => {
            const key = `${bundleItem.menuBundleId.toString()}_bundle`;
            const current = aggregatedItemsMap.get(key) || { itemId: bundleItem.menuBundleId, name: bundleItem.name, qtySold: 0, totalRevenue: 0, type: 'bundle' };
            current.qtySold += Number(bundleItem.qty);
            current.totalRevenue += Number(bundleItem.qty) * Number(bundleItem.price);
            aggregatedItemsMap.set(key, current);
        });
    }

    // C. Item Promo
    if (saleDocument.itemPromo) {
        saleDocument.itemPromo.forEach(promoItem => {
            const key = `${promoItem.menuId.toString()}_menu_promo`;
            const current = aggregatedItemsMap.get(key) || { itemId: promoItem.menuId, name: promoItem.name, qtySold: 0, totalRevenue: 0, type: 'menu_promo' };
            current.qtySold += Number(promoItem.qty);
            aggregatedItemsMap.set(key, current);
        });
    }

    // D. Item Addon (Standalone)
    // Menggunakan suffix '_addon' agar DIGABUNG dengan addon topping di laporan
    if (saleDocument.itemAddon) {
        saleDocument.itemAddon.forEach(addonItem => {
            const key = `${addonItem.addonId.toString()}_addon`; 
            const current = aggregatedItemsMap.get(key) || { 
                itemId: addonItem.addonId, 
                name: addonItem.name, 
                qtySold: 0, 
                totalRevenue: 0, 
                type: 'addon' 
            };
            current.qtySold += Number(addonItem.qty);
            current.totalRevenue += Number(addonItem.qty) * Number(addonItem.price);
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

    // WAJIB: Mark Modified agar Mongoose mendeteksi perubahan
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
 * Fungsi ini KEBALIKAN dari update. Mengurangi angka saat transaksi dihapus.
 */
export const revertDailySaleReport = async (saleDocument) => {
  try {
    const outletId = saleDocument.outlet.outletId;
    
    // --- PERBAIKAN TIMEZONE (Harus sama dengan fungsi Update) ---
    const utcDate = new Date(saleDocument.createdAt);
    const localDate = new Date(utcDate.toLocaleString("en-US", { timeZone: TIMEZONE }));
    
    const formattedDate = `${String(localDate.getFullYear()).slice(-2)}${String(localDate.getMonth() + 1).padStart(2, '0')}${String(localDate.getDate()).padStart(2, '0')}`;
    const reportId = `${outletId.toString()}_${formattedDate}`;

    console.log(`[REVERT REPORT] Mencari ID: ${reportId} untuk Sale: ${saleDocument.code} (Rp ${saleDocument.totalPrice})`);

    // Cari Laporan
    let dailyReport = await DailyOutletSaleReport.findById(reportId);

    if (!dailyReport) {
      console.warn(`[REVERT REPORT] GAGAL. Laporan dengan ID ${reportId} tidak ditemukan.`);
      return false;
    }

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

    // --- LOGIKA PENGURANGAN (REVERT) ---

    // A. Revert Item Single
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
              if (currentAddon.totalRevenue < 0) currentAddon.totalRevenue = 0;
            }
          });
        }
      });
    }

    // B. Revert Item Bundle
    if (saleDocument.itemBundle) {
      saleDocument.itemBundle.forEach(bundleItem => {
        const key = `${bundleItem.menuBundleId.toString()}_bundle`;
        if (aggregatedItemsMap.has(key)) {
          const current = aggregatedItemsMap.get(key);
          current.qtySold -= Number(bundleItem.qty);
          current.totalRevenue -= (Number(bundleItem.qty) * Number(bundleItem.price));
          
          if (current.qtySold < 0) current.qtySold = 0;
          if (current.totalRevenue < 0) current.totalRevenue = 0;
        }
      });
    }

    // C. Revert Item Promo
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

    // D. Revert Item Addon (Standalone)
    if (saleDocument.itemAddon) {
      saleDocument.itemAddon.forEach(addonItem => {
        const key = `${addonItem.addonId.toString()}_addon`;
        if (aggregatedItemsMap.has(key)) {
          const current = aggregatedItemsMap.get(key);
          current.qtySold -= Number(addonItem.qty);
          current.totalRevenue -= (Number(addonItem.qty) * Number(addonItem.price));
          
          if (current.qtySold < 0) current.qtySold = 0;
          if (current.totalRevenue < 0) current.totalRevenue = 0;
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

    // Safety Checks Global
    if (dailyReport.totalSale < 0) dailyReport.totalSale = 0;
    if (dailyReport.totalExpense < 0) dailyReport.totalExpense = 0;
    if (dailyReport.saleComplete < 0) dailyReport.saleComplete = 0;

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

/**
 * REGENERATE Daily Sales Report
 * Dipanggil jika laporan hilang. Fungsi ini akan mencari raw data Sale
 * dan menyusun ulang laporan dari nol.
 */
export const regenerateDailySaleReport = async (reportId) => {
  try {
    // 1. Parsing ID (Format: OUTLETID_YYMMDD)
    const [outletId, dateString] = reportId.split('_');
    
    if (!outletId || !dateString || dateString.length !== 6) {
      return { success: false, message: 'Format Report ID salah.' };
    }

    // 2. Konversi YYMMDD ke Date Range
    const year = 2000 + parseInt(dateString.substring(0, 2));
    const month = parseInt(dateString.substring(2, 4)) - 1; 
    const day = parseInt(dateString.substring(4, 6));

    // Buffer pencarian H-1 sampai H+1 untuk mengakomodir perbedaan timezone database
    const searchStartDate = new Date(year, month, day - 1); 
    const searchEndDate = new Date(year, month, day + 2);

    console.log(`[REGENERATE] Mencari penjualan di outlet ${outletId} sekitar tanggal ${day}-${month+1}-${year}`);

    // 3. Ambil semua penjualan aktif di rentang waktu tersebut
    const sales = await Sale.find({
      'outlet.outletId': outletId,
      isDeleted: false,
      createdAt: { 
        $gte: searchStartDate, 
        $lte: searchEndDate 
      }
    });

    if (!sales || sales.length === 0) {
      return { success: false, message: 'Tidak ditemukan data penjualan aktif untuk periode ini.' };
    }

    console.log(`[REGENERATE] Ditemukan ${sales.length} kandidat penjualan. Memproses...`);

    let processedCount = 0;

    // 4. Proses "Replay" Penjualan
    for (const sale of sales) {
      // Re-calculate ID Laporan untuk setiap sale menggunakan TIMEZONE yang sama
      const utcDate = new Date(sale.createdAt);
      const localDate = new Date(utcDate.toLocaleString("en-US", { timeZone: TIMEZONE }));
      
      const saleFormattedDate = `${String(localDate.getFullYear()).slice(-2)}${String(localDate.getMonth() + 1).padStart(2, '0')}${String(localDate.getDate()).padStart(2, '0')}`;
      const calculatedReportId = `${sale.outlet.outletId.toString()}_${saleFormattedDate}`;

      // HANYA proses jika ID laporannya COCOK dengan yang sedang kita cari
      if (calculatedReportId === reportId) {
        await updateDailySaleReport(sale);
        processedCount++;
      }
    }

    if (processedCount === 0) {
      return { success: false, message: 'Ada data penjualan, tapi tanggalnya tidak cocok dengan ID laporan (Isu Timezone).' };
    }

    // 5. Ambil laporan yang baru saja dibuat
    const newReport = await DailyOutletSaleReport.findById(reportId);
    
    if (newReport) {
      return { success: true, data: newReport };
    } else {
      return { success: false, message: 'Gagal menyimpan laporan baru.' };
    }

  } catch (error) {
    console.error('[REGENERATE ERROR]', error);
    return { success: false, message: error.message };
  }
};