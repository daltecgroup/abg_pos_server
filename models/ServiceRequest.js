import { Schema, model } from 'mongoose';
import { RequestTypes } from '../constants/requestTypes.js';
import { RequestStatuses } from '../constants/requestStatuses.js';

const ServiceRequestSchema = new Schema({
  outlet: {
    type: Schema.Types.ObjectId,
    ref: 'Outlet',
    required: true,
    index: true,
  },
  requestedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User', // Operator yang request
    required: true,
  },
  type: {
    type: String,
    enum: Object.values(RequestTypes),
    required: true,
  },
  targetId: {
    type: Schema.Types.ObjectId,
    required: true,
    // Kita tidak menggunakan 'ref' statis karena target bisa berupa Order atau Sale
  },
  targetCode: { type: String, required: false },
  reason: { // Alasan penghapusan (Wajib diisi untuk audit)
    type: String,
    required: true,
    trim: true,
  },
  status: {
    type: String,
    enum: Object.values(RequestStatuses),
    default: RequestStatuses.PENDING,
    index: true,
  },
  isCompleted: { 
    type: Boolean,
    default: false,
  },
  adminResponse: { // Catatan dari admin saat approve/reject
    type: String,
    trim: true,
    default: null
  },
  resolvedBy: { // Siapa admin yang memproses
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    name: { type: String },
    _id: false
  },
  resolvedAt: {
    type: Date,
    default: null
  },
  // Standard Audit Fields
  isDeleted: {
    type: Boolean,
    default: false, 
    index: true,
  },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default model('ServiceRequest', ServiceRequestSchema);