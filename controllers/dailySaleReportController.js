import DailyOutletSaleReport from '../models/DailyOutletSaleReport.js';
import mongoose from 'mongoose'; // For ObjectId validation (though _id is string here)

// @desc    Get a single daily outlet sale report by ID
// @route   GET /api/v1/dailyoutletsalereports/:id
// @access  Private (Admin, SPV Area, or Operator for their outlet)
export const getDailyOutletSaleReportById = async (req, res) => {
  try {
    const { id } = req.params;

    // The ID format is `${outletId}_${YYMMDD}`. While it's a string,
    // we can still do some basic validation if needed, but Mongoose will handle
    // if it doesn't match a document.
    // For example, you could check if it contains '_' and if the outletId part is a valid ObjectId.
    const idParts = id.split('_');
    if (idParts.length !== 2 || !mongoose.Types.ObjectId.isValid(idParts[0])) {
        return res.status(400).json({ message: 'Format ID Laporan Penjualan Harian Outlet tidak valid. Harap gunakan format OutletID_YYMMDD.' });
    }

    const report = await DailyOutletSaleReport.findById(id);

    if (!report) {
      return res.status(404).json({ message: 'Laporan penjualan harian outlet tidak ditemukan.' });
    }

    // Optional: Implement authorization logic here
    // For example, if req.user is an operator, ensure report.outlet.outletId matches req.user's outlet.
    // if (req.user && req.user.roles.includes(Roles.operator)) {
    //   if (report.outlet.outletId.toString() !== req.user.outletId.toString()) { // Assuming req.user has outletId
    //     return res.status(403).json({ message: 'Anda tidak diizinkan untuk melihat laporan ini.' });
    //   }
    // }

    res.status(200).json(report.toJSON());
  } catch (error) {
    console.error('Kesalahan saat mengambil laporan penjualan harian outlet berdasarkan ID:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengambil laporan penjualan harian outlet.', error: error.message });
  }
};

// @desc    Get all daily outlet sale reports
// @route   GET /api/v1/dailyoutletsalereports
// @access  Private (Admin, SPV Area)
export const getDailyOutletSaleReports = async (req, res) => {
  try {
    const filter = {};
    const { outletId, dateFrom, dateTo } = req.query;

    if (outletId) {
      if (!mongoose.Types.ObjectId.isValid(outletId)) {
        return res.status(400).json({ message: 'ID Outlet tidak valid untuk filter.' });
      }
      filter['outlet.outletId'] = outletId;
    }
    if (dateFrom || dateTo) {
      filter.date = {};
      if (dateFrom) {
        const d = new Date(dateFrom);
        if (isNaN(d.getTime())) { return res.status(400).json({ message: 'Format tanggal "dateFrom" tidak valid.' }); }
        filter.date.$gte = new Date(d.setUTCHours(0,0,0,0));
      }
      if (dateTo) {
        const d = new Date(dateTo);
        if (isNaN(d.getTime())) { return res.status(400).json({ message: 'Format tanggal "dateTo" tidak valid.' }); }
        filter.date.$lte = new Date(d.setUTCHours(23,59,59,999));
      }
    }

    const reports = await DailyOutletSaleReport.find(filter).sort({ date: -1, 'outlet.name': 1 });
    res.status(200).json(reports.map(report => report.toJSON()));
  } catch (error) {
    console.error('Kesalahan saat mengambil laporan penjualan harian outlet:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengambil laporan penjualan harian outlet.', error: error.message });
  }
};
