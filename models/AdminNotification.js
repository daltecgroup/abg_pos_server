import mongoose from 'mongoose';

const adminNotificationSchema = new mongoose.Schema({
    type: {
        type: String,
        required: true,
        enum: ['INFO', 'WARNING', 'REQUEST', 'SYSTEM'], // Bisa disesuaikan
        default: 'INFO'
    },
    title: {
        type: String,
        required: true
    },
    content: {
        type: String,
        required: true
    },
    outlet: { // Menggunakan object reference agar bisa dipopulate
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Outlet',
        required: false 
    },
    targetId: { // Opsional: ID dari Order/Request terkait agar bisa diklik
        type: String, 
        required: false 
    },
    isOpened: {
        type: Boolean,
        default: false
    },
    isDeleted: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true 
});

const AdminNotification = mongoose.model('AdminNotification', adminNotificationSchema);
export default AdminNotification;