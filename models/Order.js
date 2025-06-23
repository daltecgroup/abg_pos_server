import mongoose, { Schema, model } from 'mongoose';
import { OrderStatuses } from '../constants/orderStatuses.js'; // NEW: Import OrderStatuses

// --- Counter Schema for Order Codes ---
const OrderCounterSchema = new Schema({
  _id: { type: String, required: true }, // e.g., 'orderCode'
  seq: { type: Number, default: 0 },
});
const OrderCounter = mongoose.models.OrderCounter || mongoose.model('OrderCounter', OrderCounterSchema);

const OrderSchema = new Schema({
  code: {
    type: String,
    trim: true,
    uppercase: true,
    index: true,
    unique: true, // Order code must be unique
  },
  status: { // e.g., 'ordered', 'processed', 'ontheway', 'accepted', 'returned', 'failed'
    type: String,
    enum: Object.values(OrderStatuses), // MODIFIED: Use the new OrderStatuses enum
    default: OrderStatuses.ORDERED, // MODIFIED: Default to 'ordered'
    index: true,
  },
  outlet: { // Embedded document: Snapshot of outlet details that placed the order
    outletId: {
      type: Schema.Types.ObjectId,
      ref: 'Outlet',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    address: { // Include address as a sub-document within the outlet snapshot
      province: { type: String, trim: true },
      regency: { type: String, trim: true },
      district: { type: String, trim: true },
      village: { type: String, trim: true },
      street: { type: String, trim: true },
      _id: false
    },
    _id: false
  },
  // REMOVED: customerName and customerPhone are no longer needed for ingredient orders
  items: [ // Array of ingredient items in the order
    {
      ingredientId: {
        type: Schema.Types.ObjectId,
        ref: 'Ingredient', // Reference to the Ingredient document
        required: true,
      },
      name: { type: String, required: true, trim: true }, // Snapshot of ingredient name
      unit: { type: String, required: true, trim: true }, // NEW: Snapshot of ingredient unit
      qty: { type: Number, required: true, min: 1 },
      price: { type: Number, required: true, min: 0 }, // Snapshot of ingredient price at time of order
      notes: { type: String, trim: true, default: null },
      isAccepted: { // Marks if this ingredient item has been accepted/received by the outlet from HQ
        type: Boolean,
        default: false,
      },
      // Reference to the OutletInventoryTransaction created when this ingredient item is accepted (received)
      outletInventoryTransactionId: {
        type: Schema.Types.ObjectId,
        ref: 'OutletInventoryTransaction',
        default: null, // Will be populated when isAccepted becomes true
      },
      _id: false
    }
  ],
  totalPrice: { // Total calculated cost of all ordered ingredients
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
  createdBy: { // User who placed the order (e.g., Outlet Operator/Manager)
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    _id: false
  },
  isDeleted: {
    type: Boolean,
    default: false,
    index: true,
  },
  deletedAt: {
    type: Date,
    default: null,
  },
  deletedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
}, {
  timestamps: true, // Adds createdAt and updatedAt
  toJSON: {
    virtuals: true,
    getters: true,
    transform: (doc, ret) => {
      delete ret.__v;
      delete ret._id;
      return ret;
    }
  },
  toObject: {
    virtuals: true,
    getters: true,
  }
});

// Virtual for id
OrderSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

// --- Pre-save hook to generate automatic 'code' (ORDER + YYMMDD + 3 digit counter) ---
OrderSchema.pre('save', async function(next) {
  if (this.isNew) { // Only generate code for new documents
    const today = new Date();
    // Format date: YYMMDD (e.g., 240623)
    const formattedDate = `${String(today.getFullYear()).slice(-2)}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

    const counterId = `order_${formattedDate}`; // Counter per day

    try {
      const counter = await OrderCounter.findOneAndUpdate(
        { _id: counterId },
        { $inc: { seq: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // Final order code format: ORDER + YYMMDD + 3 DIGIT COUNTER
      this.code = `ORDER${formattedDate}${String(counter.seq).padStart(3, '0')}`;

    } catch (error) {
      console.error('Kesalahan saat membuat kode pesanan:', error);
      return next(new Error('Gagal membuat kode pesanan. Silakan coba lagi.'));
    }
  }
  next();
});

// Pre-findOneAndUpdate hook for soft delete logic
OrderSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  if (update && update.isDeleted === true) {
    if (!update.deletedAt) {
      update.deletedAt = new Date();
    }
    // In a real application, you'd typically get the deletedBy user ID from the request context (e.g., req.user.id)
  }
  next();
});

export default model('Order', OrderSchema);
