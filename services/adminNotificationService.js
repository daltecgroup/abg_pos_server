import AdminNotification from '../models/AdminNotification.js';
import mongoose from 'mongoose';

/**
 * Membuat Notifikasi Baru untuk Admin
 * UPDATE: Mencegah duplikasi jika targetId & type sama persis.
 */
export const createAdminNotification = async (data) => {
    try {
        const { type, title, content, outletId, targetId } = data;

        // --- 1. CEK DUPLIKASI (Anti-Redundansi) ---
        // Kita hanya cek jika targetId ada (karena notifikasi umum mungkin tidak punya targetId)
        if (targetId) {
            const existingNotification = await AdminNotification.findOne({
                targetId: targetId,
                type: type,
                isDeleted: false // Hanya cek yang masih aktif
            });

            if (existingNotification) {
                console.log(`[Notification Skipped] Duplikat ditemukan untuk Target: ${targetId}, Type: ${type}`);
                
                // Jika notifikasi sudah ada tapi "sudah dibuka/read", 
                // opsional: kita bisa set isOpened = false lagi agar admin notice lagi.
                // Tapi sesuai instruksi Anda "jangan buat", kita return saja yang lama.
                
                return { 
                    success: true, 
                    data: existingNotification, 
                    message: 'Notifikasi duplikat, pembuatan dibatalkan.',
                    isDuplicate: true 
                };
            }
        }

        // --- 2. BUAT NOTIFIKASI BARU ---
        const newNotification = await AdminNotification.create({
            type,
            title,
            content,
            outlet: outletId || null,
            targetId: targetId || null,
            isOpened: false,
            isDeleted: false
        });

        return { success: true, data: newNotification };

    } catch (error) {
        console.error('Error creating admin notification:', error);
        return { success: false, message: error.message };
    }
};

/**
 * Mengambil daftar notifikasi
 */
export const getAdminNotifications = async (filters = {}) => {
    try {
        const query = { isDeleted: false };
        
        if (filters.isOpened !== undefined) {
            query.isOpened = filters.isOpened === 'true';
        }
        
        // Pagination: Ambil 50 terakhir
        const notifications = await AdminNotification.find(query)
            .populate('outlet', 'name code')
            .sort({ createdAt: -1 }) // Terbaru di atas
            .limit(50);

        // Hitung unread count
        const unreadCount = await AdminNotification.countDocuments({ isDeleted: false, isOpened: false });

        return { success: true, data: { notifications, unreadCount } };
    } catch (error) {
        return { success: false, message: error.message };
    }
};

/**
 * Menandai notifikasi sudah dibaca (Opened)
 */
export const openAdminNotification = async (id) => {
    try {
        const notification = await AdminNotification.findByIdAndUpdate(
            id,
            { isOpened: true },
            { new: true }
        );

        if (!notification) return { success: false, message: 'Notifikasi tidak ditemukan.' };

        return { success: true, data: notification };
    } catch (error) {
        return { success: false, message: error.message };
    }
};

/**
 * Menghapus notifikasi (Soft Delete)
 */
export const deleteAdminNotification = async (id) => {
    try {
        const notification = await AdminNotification.findByIdAndUpdate(
            id,
            { isDeleted: true },
            { new: true }
        );

        if (!notification) return { success: false, message: 'Notifikasi tidak ditemukan.' };

        return { success: true, message: 'Notifikasi berhasil dihapus.' };
    } catch (error) {
        return { success: false, message: error.message };
    }
};