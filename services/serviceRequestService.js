import ServiceRequest from '../models/ServiceRequest.js';
import Order from '../models/Order.js';
import Sale from '../models/Sale.js';
import Outlet from '../models/Outlet.js';
import OutletInventoryTransaction from '../models/OutletInventoryTransaction.js';
import mongoose from 'mongoose';
import { RequestTypes } from '../constants/requestTypes.js';
import { RequestStatuses } from '../constants/requestStatuses.js';
import { OrderStatuses } from '../constants/orderStatuses.js';
import { SourceTypes } from '../constants/sourceTypes.js';
import * as outletInventoryService from './outletInventoryService.js';
import { revertDailySaleReport } from './dailySaleReportService.js';

export const createServiceRequest = async (data, userContext) => {
    const { outletId, type, targetId, reason } = data;
    const errors = [];

    if (!mongoose.Types.ObjectId.isValid(outletId)) errors.push('ID Outlet tidak valid.');
    const outlet = await Outlet.findById(outletId);
    if (!outlet) errors.push('Outlet tidak ditemukan.');
    if (!Object.values(RequestTypes).includes(type)) errors.push('Tipe request tidak valid.');
    if (!mongoose.Types.ObjectId.isValid(targetId)) errors.push('Target ID tidak valid.');

    if (errors.length > 0) return { success: false, errors };

    let targetCode = "";

    if (type === RequestTypes.DELETE_ORDER) {
        const targetOrder = await Order.findOne({
            _id: targetId,
            'outlet.outletId': outletId,
            isDeleted: false
        });
        if (!targetOrder) return { success: false, message: 'Target Order tidak ditemukan...' };
        targetCode = targetOrder.code;
    } else if (type === RequestTypes.DELETE_SALE) {
        const targetSale = await Sale.findOne({
            _id: targetId,
            'outlet.outletId': outletId,
            isDeleted: false
        });
        if (!targetSale) return { success: false, message: 'Target Sale tidak ditemukan...' };
        targetCode = targetSale.code;
    }

    const existingRequest = await ServiceRequest.findOne({
        targetId: targetId, type: type, status: RequestStatuses.PENDING, isDeleted: false
    });
    if (existingRequest) return { success: false, message: 'Sudah ada permintaan yang sedang diproses.' };

    try {
        const newRequest = await ServiceRequest.create({
            outlet: outletId, requestedBy: userContext.userId, type, targetId, reason,
            status: RequestStatuses.PENDING, isCompleted: false, targetCode: targetCode
        });
        return { success: true, data: newRequest };
    } catch (error) {
        console.error('Error creating service request:', error);
        return { success: false, message: 'Gagal membuat service request di database.' };
    }
};

export const processServiceRequest = async (requestId, action, adminNote, userContext) => {
    const request = await ServiceRequest.findById(requestId);
    if (!request || request.isDeleted) return { success: false, message: 'Request tidak ditemukan.' };
    if (request.isCompleted) return { success: false, message: 'Request ini sudah diproses sebelumnya.' };

    try {
        let newStatus = RequestStatuses.PENDING;

        if (action === 'reject') {
            newStatus = RequestStatuses.REJECTED;
        } else if (action === 'approve') {
            newStatus = RequestStatuses.APPROVED;

            // --- 1. LOGIKA DELETE ORDER ---
            if (request.type === RequestTypes.DELETE_ORDER) {
                const order = await Order.findById(request.targetId);

                if (order && !order.isDeleted) {

                    // Jika status ACCEPTED, berarti stok sudah masuk (IN). Kita harus hapus transaksi stoknya.
                    if (order.status === OrderStatuses.ACCEPTED) {
                        console.log(`Menghapus Transaksi Inventory untuk Order ID: ${order._id}`);

                        // PERBAIKAN: Konversi ke String agar cocok dengan database
                        const deleteResult = await OutletInventoryTransaction.updateMany(
                            {
                                'source.sourceType': SourceTypes.ORDER,
                                'source.ref': order.code.toString(), // Pastikan String
                                isDeleted: false
                            },
                            {
                                $set: {
                                    isDeleted: true,
                                    deletedAt: new Date(),
                                    deletedBy: userContext.userId
                                }
                            }
                        );
                        console.log(`Hasil Update OIT (Order): ${deleteResult.modifiedCount} dokumen dihapus.`);
                    }

                    // Soft Delete Order
                    order.isDeleted = true;
                    order.deletedAt = new Date();
                    order.deletedBy = userContext.userId;
                    await order.save();

                } else {
                    throw new Error('Target Order sudah tidak aktif atau tidak ditemukan.');
                }
            }
            // --- 2. LOGIKA DELETE SALE ---
            else if (request.type === RequestTypes.DELETE_SALE) {
                const sale = await Sale.findById(request.targetId);

                if (sale && !sale.isDeleted) {
                    // Soft Delete Sale
                    sale.isDeleted = true;
                    sale.deletedAt = new Date();
                    sale.deletedBy = userContext.userId;
                    await sale.save();

                    // PERBAIKAN: Menggunakan struktur 'source' (bukan refId) & konversi String
                    console.log(`Menghapus Transaksi Inventory untuk Sale ID: ${sale._id}`);
                    const deleteSaleResult = await OutletInventoryTransaction.updateMany(
                        {
                            'source.sourceType': SourceTypes.SALE, // Cek Source SALE
                            'source.ref': sale.code.toString(),    // Pastikan String
                            isDeleted: false
                        },
                        {
                            $set: {
                                isDeleted: true,
                                deletedAt: new Date(),
                                deletedBy: userContext.userId
                            }
                        }
                    );

                    await revertDailySaleReport(sale);


                    console.log(`Hasil Update OIT (Sale): ${deleteSaleResult.modifiedCount} dokumen dihapus.`);
                } else {
                    throw new Error('Target Sale sudah tidak aktif atau tidak ditemukan.');
                }
            }
        } else {
            throw new Error('Aksi tidak valid (harus approve/reject).');
        }

        // Update Service Request
        request.status = newStatus;
        request.isCompleted = true;
        request.adminResponse = adminNote;
        request.resolvedBy = { userId: userContext.userId, name: userContext.userName };
        request.resolvedAt = new Date();

        await request.save();

        // Trigger Recalculate Inventory
        if (action === 'approve') {
            console.log("Memicu Recalculate Inventory...");
            outletInventoryService.recalculateAllOutletInventories()
                .then(() => console.log("Recalculate selesai."))
                .catch(err => console.error("Recalculate error:", err));
        }

        return { success: true, data: request };

    } catch (error) {
        console.error('Error processing service request:', error);
        return { success: false, message: error.message };
    }
};

export const deleteServiceRequest = async (requestId, userContext) => {
    try {
        const request = await ServiceRequest.findById(requestId);
        if (!request || request.isDeleted) return { success: false, message: 'Permintaan tidak ditemukan.' };
        if (request.status !== RequestStatuses.PENDING || request.isCompleted) {
            return { success: false, message: 'Permintaan yang sudah diproses tidak dapat dibatalkan.' };
        }
        request.isDeleted = true;
        request.deletedAt = new Date();
        request.deletedBy = userContext.userId;
        await request.save();
        return { success: true, message: 'Permintaan berhasil dibatalkan.', data: request };
    } catch (error) {
        return { success: false, message: error.message };
    }
};

export const getServiceRequests = async (filters) => {
    const query = { isDeleted: false };
    if (filters.outletId) query.outlet = filters.outletId;
    if (filters.status) query.status = filters.status;
    if (filters.type) query.type = filters.type;
    return await ServiceRequest.find(query)
        .populate('outlet', 'name code')
        .populate('requestedBy', 'name userId')
        .populate('resolvedBy.userId', 'name')
        .sort({ createdAt: -1 });
};