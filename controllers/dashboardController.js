import * as dashboardService from '../services/dashboardService.js';

// @desc    Get Dashboard Statistics (Today & This Month)
// @route   GET /api/v1/dashboard
export const getDashboard = async (req, res) => {
    try {
        const { outletId } = req.query; // Hanya butuh Outlet ID (Opsional)

        // Tidak perlu kirim startDate/endDate, Service akan otomatis hitung 2 periode.
        const result = await dashboardService.getDashboardStats(outletId);

        if (!result.success) {
            return res.status(500).json({ message: result.message });
        }

        res.status(200).json({
            message: 'Data dashboard (Hari Ini & Bulan Ini) berhasil dimuat.',
            data: result.data
        });

    } catch (error) {
        console.error('Dashboard Controller Error:', error);
        res.status(500).json({ message: 'Terjadi kesalahan server saat memuat dashboard.' });
    }
};