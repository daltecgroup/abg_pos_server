import DailyOutletSaleReport from '../models/DailyOutletSaleReport.js';
import ServiceRequest from '../models/ServiceRequest.js';
import OutletInventory from '../models/OutletInventory.js';
import Attendance from '../models/Attendance.js';
import Outlet from '../models/Outlet.js';
import User from '../models/User.js';
import { Roles } from '../constants/roles.js';
import { RequestStatuses } from '../constants/requestStatuses.js';
import mongoose from 'mongoose';

/**
 * UTAMA: Mengambil Data Dashboard (Dual View: Hari Ini & Bulan Ini)
 */
export const getDashboardStats = async (outletIdParam) => {
    // 1. Validasi & Konversi Outlet ID
    let outletObjectId = null;
    if (outletIdParam) {
        if (mongoose.Types.ObjectId.isValid(outletIdParam)) {
            outletObjectId = new mongoose.Types.ObjectId(outletIdParam);
        } else {
            return { success: false, message: "Format ID Outlet tidak valid" };
        }
    }

    // 2. Tentukan Rentang Waktu
    const now = new Date();
    
    // A. Range HARI INI (00:00 - 23:59)
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const endToday = new Date(now);
    endToday.setHours(23, 59, 59, 999);

    // B. Range BULAN INI (Tgl 1 - Sekarang)
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endMonth = new Date(now); // Sampai detik ini

    try {
        // 3. JALANKAN QUERY PARALEL (4 Thread Sekaligus)
        // Kita meminta DB mengerjakan data Hari Ini, Bulan Ini, dan Stok Alert bersamaan.
        const [todayStats, monthStats, inventoryAlerts] = await Promise.all([
            getStatsForPeriod(startToday, endToday, outletObjectId),
            getStatsForPeriod(startMonth, endMonth, outletObjectId),
            getInventoryAlerts(outletObjectId) // Stok tidak butuh range waktu (Snapshot Realtime)
        ]);

        return {
            success: true,
            data: {
                today: todayStats,       // Data detail Hari Ini
                thisMonth: monthStats,   // Data detail Bulan Ini
                inventoryAlerts: inventoryAlerts // Peringatan Stok (Realtime)
            }
        };

    } catch (error) {
        console.error('Dashboard Service Error:', error);
        return { success: false, message: error.message };
    }
};

// --- WORKER FUNCTION (Dipanggil untuk Today & Month) ---
const getStatsForPeriod = async (startDate, endDate, outletObjectId) => {
    // Build Query Filters
    const dateQuery = { $gte: startDate, $lte: endDate };
    
    const reportFilter = { date: dateQuery };
    const commonFilter = { createdAt: dateQuery };
    const attendanceFilter = { date: dateQuery };

    if (outletObjectId) {
        reportFilter['outlet.outletId'] = outletObjectId;
        commonFilter.outlet = outletObjectId;
        attendanceFilter.outlet = outletObjectId;
    }

    // Jalankan sub-query paralel untuk periode ini
    const [financials, operations, topProducts] = await Promise.all([
        getFinancialSummary(reportFilter),
        getOperationalSummary(commonFilter, attendanceFilter, outletObjectId),
        getTopProducts(reportFilter)
    ]);

    return {
        range: { start: startDate, end: endDate },
        financials,
        operations,
        topProducts
    };
};

// --- HELPER FUNCTIONS (Logika Perhitungan) ---

const getFinancialSummary = async (filter) => {
    const result = await DailyOutletSaleReport.aggregate([
        { $match: filter },
        {
            $group: {
                _id: null,
                totalRevenue: { $sum: "$totalSale" },
                totalExpense: { $sum: "$totalExpense" }, // HPP Otomatis
                totalTransactions: { $sum: "$saleComplete" }
            }
        }
    ]);

    const data = result[0] || { totalRevenue: 0, totalExpense: 0, totalTransactions: 0 };
    return {
        revenue: data.totalRevenue,
        expense: data.totalExpense,
        netProfit: data.totalRevenue - data.totalExpense,
        transactions: data.totalTransactions,
        // Margin Laba Kotor (%)
        margin: data.totalRevenue > 0 
            ? ((data.totalRevenue - data.totalExpense) / data.totalRevenue * 100).toFixed(1) + '%' 
            : '0%'
    };
};

const getOperationalSummary = async (commonFilter, attendanceFilter, outletObjectId) => {
    // 1. Pending Requests (Hanya hitung yang dibuat DALAM periode ini)
    const requestQuery = { 
        ...commonFilter,
        status: RequestStatuses.PENDING, 
        isDeleted: false 
    };
    const pendingRequestsCount = await ServiceRequest.countDocuments(requestQuery);

    // 2. Attendance Stats
    const activeOperatorsCount = await Attendance.countDocuments(attendanceFilter);
    const activeOutletsList = await Attendance.distinct('outlet', attendanceFilter);

    // 3. Total Master Data (Statis, tidak terpengaruh filter tanggal)
    // Kita hitung sekali saja biar efisien (atau bisa di-cache), 
    // tapi disini kita masukkan agar frontend mudah akses.
    let totalOutlets = 0;
    let totalOperators = 0;

    if (outletObjectId) {
        totalOutlets = 1;
        const outletDoc = await Outlet.findById(outletObjectId);
        totalOperators = outletDoc?.operators?.length || 0;
    } else {
        totalOutlets = await Outlet.countDocuments({ isDeleted: false, isActive: true });
        totalOperators = await User.countDocuments({ roles: Roles.operator, isDeleted: false, isActive: true });
    }

    return {
        pendingRequests: pendingRequestsCount,
        activeOperators: activeOperatorsCount, // Jumlah Check-In pada periode ini
        activeOutlets: activeOutletsList.length, // Jumlah Outlet buka pada periode ini
        totalOperatorsMaster: totalOperators,
        totalOutletsMaster: totalOutlets
    };
};

const getInventoryAlerts = async (outletObjectId) => {
    const matchStage = { 'ingredients.currentQty': { $lte: 0 } };
    if (outletObjectId) matchStage._id = outletObjectId; 

    const alerts = await OutletInventory.aggregate([
        { $match: matchStage },
        { $unwind: "$ingredients" },
        { $match: { "ingredients.currentQty": { $lte: 0 } } }, 
        { $project: {
            _id: 0,
            outletId: "$_id",
            ingredientName: "$ingredients.name",
            currentQty: "$ingredients.currentQty",
            unit: "$ingredients.unit"
        }},
        { $limit: 10 }
    ]);
    return alerts;
};

const getTopProducts = async (filter) => {
    return await DailyOutletSaleReport.aggregate([
        { $match: filter },
        { $unwind: "$itemSold" },
        {
            $group: {
                _id: "$itemSold.name",
                type: { $first: "$itemSold.type" },
                qtySold: { $sum: "$itemSold.qtySold" },
                revenueContribution: { $sum: "$itemSold.totalRevenue" }
            }
        },
        { $sort: { qtySold: -1 } },
        { $limit: 5 } // Top 5
    ]);
};