import DailyOutletSaleReport from '../models/DailyOutletSaleReport.js';
import mongoose from 'mongoose';
// Import fungsi regenerasi yang sudah kita buat sebelumnya
import { regenerateDailySaleReport } from '../services/dailySaleReportService.js';

// @desc    Get a single daily outlet sale report by ID
// @route   GET /api/v1/dailyoutletsalereports/:id
export const getDailyOutletSaleReportById = async (req, res) => {
  try {
    const { id } = req.params;

    const idParts = id.split('_');
    if (idParts.length !== 2 || !mongoose.Types.ObjectId.isValid(idParts[0])) {
        return res.status(400).json({ message: 'Format ID Laporan tidak valid. Gunakan OutletID_YYMMDD.' });
    }

    // 1. Coba cari laporan secara normal
    let report = await DailyOutletSaleReport.findById(id);

    // 2. Jika tidak ditemukan, coba GENERATE ULANG (Self-Healing)
    if (!report) {
      console.warn(`Laporan ${id} tidak ditemukan. Memulai regenerasi otomatis...`);
      const regenerationResult = await regenerateDailySaleReport(id);
      
      if (regenerationResult.success) {
        report = regenerationResult.data;
        console.log(`Laporan ${id} berhasil diregenerasi.`);
      } else {
        // Jika tetap gagal (memang tidak ada sale), return 404
        return res.status(404).json({ message: 'Laporan tidak ditemukan dan tidak ada data penjualan untuk dibuat.' });
      }
    }

    res.status(200).json(report.toJSON());
  } catch (error) {
    console.error('Kesalahan server:', error);
    res.status(500).json({ message: 'Kesalahan server.', error: error.message });
  }
};

// @desc    Get all daily outlet sale reports (dengan fitur Auto-Fill Gaps)
// @route   GET /api/v1/dailyoutletsalereports
export const getDailyOutletSaleReports = async (req, res) => {
  try {
    const filter = {};
    const { outletId, dateFrom, dateTo, recalculate } = req.query; // Tambah parameter optional 'recalculate'

    // Validasi Outlet ID
    if (outletId) {
      if (!mongoose.Types.ObjectId.isValid(outletId)) {
        return res.status(400).json({ message: 'ID Outlet tidak valid.' });
      }
      filter['outlet.outletId'] = outletId;
    }

    // Validasi Tanggal
    let startDate, endDate;
    if (dateFrom || dateTo) {
      filter.date = {};
      if (dateFrom) {
        startDate = new Date(dateFrom);
        if (isNaN(startDate.getTime())) return res.status(400).json({ message: 'Format dateFrom salah.' });
        filter.date.$gte = new Date(startDate.setUTCHours(0,0,0,0));
      }
      if (dateTo) {
        endDate = new Date(dateTo);
        if (isNaN(endDate.getTime())) return res.status(400).json({ message: 'Format dateTo salah.' });
        filter.date.$lte = new Date(endDate.setUTCHours(23,59,59,999));
      }
    }

    // 1. Ambil Laporan yang Sudah Ada di Database
    let reports = await DailyOutletSaleReport.find(filter).sort({ date: -1, 'outlet.name': 1 });

    // 2. LOGIKA "GAP FILLING" (Hanya jalan jika Outlet & Range Tanggal spesifik dipilih)
    if (outletId && dateFrom && dateTo) {
      
      const existingReportIds = new Set(reports.map(r => r._id.toString()));
      const missingReportIds = [];

      // Loop dari startDate sampai endDate untuk mencari tanggal yang bolong
      let loopDate = new Date(startDate);
      while (loopDate <= endDate) {
        // Format ID: YYMMDD
        const formattedDate = `${String(loopDate.getFullYear()).slice(-2)}${String(loopDate.getMonth() + 1).padStart(2, '0')}${String(loopDate.getDate()).padStart(2, '0')}`;
        const potentialReportId = `${outletId}_${formattedDate}`;

        // Jika ID ini tidak ada di hasil database ATAU user minta force recalculate
        if (!existingReportIds.has(potentialReportId) || recalculate === 'true') {
          missingReportIds.push(potentialReportId);
        }

        // Lanjut ke hari berikutnya
        loopDate.setDate(loopDate.getDate() + 1);
      }

      // Jika ada laporan yang hilang/perlu direfresh, regenerate sekarang
      if (missingReportIds.length > 0) {
        console.log(`[GAP FILLING] Mencoba regenerasi untuk: ${missingReportIds.join(', ')}`);
        
        // Proses secara parallel (Promise.all) agar cepat
        const regenerationPromises = missingReportIds.map(id => regenerateDailySaleReport(id));
        const results = await Promise.all(regenerationPromises);

        // Masukkan hasil yang sukses ke dalam list 'reports'
        for (const res of results) {
          if (res.success && res.data) {
            // Jika recalculate=true, kita harus replace data lama di array 'reports'
            if (recalculate === 'true') {
               reports = reports.filter(r => r._id !== res.data._id); // Buang yang lama
            }
            reports.push(res.data); // Masukkan yang baru
          }
        }
        
        // Sort ulang karena ada data baru yang masuk
        reports.sort((a, b) => new Date(b.date) - new Date(a.date));
      }
    }

    res.status(200).json(reports.map(report => report.toJSON()));

  } catch (error) {
    console.error('Kesalahan saat mengambil laporan penjualan harian:', error);
    res.status(500).json({ message: 'Kesalahan server.', error: error.message });
  }
};