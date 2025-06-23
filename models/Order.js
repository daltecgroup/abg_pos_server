import mongoose, { Schema, model } from 'mongoose';
import Counter from './OrderCounter.js';
import { OrderStatuses } from '../constants/orderStatuses.js';

const OrderSchema = new Schema({
  code: {
    type: String,
    trim: true,
    uppercase: true,
    index: true,
    unique: true, // Order code must be unique
  },
  outlet: { // Embedded document for outlet details (snapshot at time of order)
    outletId: {
      type: Schema.Types.ObjectId,
      ref: 'Outlet',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    address: { // Snapshot of address details
      province: { type: String, trim: true },
      regency: { type: String, trim: true },
      district: { type: String, trim: true },
      village: { type: String, trim: true },
      street: { type: String, trim: true },
      _id: false // Prevents Mongoose from adding an _id to the embedded address object
    },
    _id: false // Prevents Mongoose from adding an _id to the embedded outlet object
  },
  items: [ // Array of embedded documents for ordered ingredients
    {
      ingredientId: {
        type: Schema.Types.ObjectId,
        ref: 'Ingredient',
        required: true,
      },
      name: { type: String, required: true, trim: true }, // Ingredient name snapshot
      qty: { type: Number, required: true, min: 0 },
      price: { type: Number, required: true, min: 0 }, // Ingredient price snapshot at time of order
      unit: { type: String, required: true, trim: true }, // Ingredient unit snapshot
      isAccepted: { type: Boolean, default: false }, // Status for individual item acceptance
      _id: false // Prevents Mongoose from adding an _id to each subdocument in the array
    }
  ],
  total: {
    type: Number,
    required: true,
    min: 0,
    default: 0 // Will be calculated dynamically
  },
  status: {
    type: String,
    enum: Object.values(OrderStatuses), // MODIFIED: Using enum from OrderStatuses file
    default: OrderStatuses.ORDERED, // MODIFIED: Using enum from OrderStatuses file
    required: true
  },
  createdBy: { // Who created the order
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    userName: {
      type: String,
      required: true,
      trim: true
    },
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
    ref: 'User', // Reference to User model (if you implement UserSchema)
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

// --- Pre-save hook to generate automatic 'code' with daily reset ---
OrderSchema.pre('save', async function(next) {
  if (this.isNew) { // Only generate code for new documents
    const today = new Date();
    // Format date for counter ID: YYMMDD (e.g., 240622)
    const formattedDate = `${String(today.getFullYear()).slice(-2)}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const counterId = `order_${formattedDate}`;

    try {
      // Find and update the counter for today. Upsert creates it if it doesn't exist.
      const counter = await Counter.findOneAndUpdate(
        { _id: counterId },
        { $inc: { seq: 1 } },
        { upsert: true, new: true }
      );

      // Check if the lastResetDate for this counter document is from a previous day.
      // This handles cases where the server might restart or if it's the first order of a new day.
      const lastResetDateOnly = new Date(counter.lastResetDate).toDateString();
      const todayDateOnly = today.toDateString();

      let currentSeq = counter.seq;
      if (lastResetDateOnly !== todayDateOnly) {
        // If it's a new day, reset sequence to 1
        const newCounter = await Counter.findOneAndUpdate(
          { _id: counterId },
          { seq: 1, lastResetDate: today }, // Set seq to 1 and update lastResetDate
          { new: true }
        );
        currentSeq = newCounter.seq;
      } else {
        // If it's the same day, just update lastResetDate for consistency
        await Counter.updateOne({ _id: counterId }, { lastResetDate: today });
      }

      // Format the sequence number with leading zeros (e.g., 001, 010, 123)
      this.code = `ORDER${formattedDate}${String(currentSeq).padStart(3, '0')}`;

    } catch (error) {
      console.error('Gagal membuat kode pesanan:', error);
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
