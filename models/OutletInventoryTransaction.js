import mongoose, { Schema, model } from 'mongoose';
import { TransactionTypes, TransactionTypeAbbreviations } from '../constants/transactionTypes.js';
import { SourceTypes } from '../constants/sourceTypes.js';

// --- Counter Schema for OutletInventoryTransaction Codes ---
// This counter needs to track sequence per day AND per outlet.
const InventoryTransactionCounterSchema = new Schema({
  _id: { type: String, required: true }, // Format: 'invtrx_YYMMDD_OUTLETCODE'
  seq: { type: Number, default: 0 },
});
const InventoryTransactionCounter = mongoose.models.InventoryTransactionCounter || mongoose.model('InventoryTransactionCounter', InventoryTransactionCounterSchema);

const OutletInventoryTransactionSchema = new Schema({
  code: {
    type: String,
    trim: true,
    uppercase: true,
    index: true,
    unique: true, // Transaction code must be unique
  },
  isValid: { // Marks if the transaction is considered valid (e.g., after review)
    type: Boolean,
    default: false,
  },
  validatedAt: { // Timestamp when isValid was set to true
    type: Date,
    default: null,
  },
  ingredient: { // Embedded document: Snapshot of ingredient details at transaction time
    ingredientId: {
      type: Schema.Types.ObjectId,
      ref: 'Ingredient',
      required: true,
    },
    name: { // Snapshot of ingredient name (can be null if original ingredient is deleted/not found)
      type: String,
      default: null, // Set to null if the ingredient is not found
      trim: true
    },
    unit: { // Snapshot of ingredient unit
      type: String,
      default: null, // Set to null if the ingredient is not found
      trim: true
    },
    _id: false
  },
  price: { // Price of the ingredient at the time of transaction
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
  outlet: { // Embedded document: Snapshot of outlet details at transaction time
    outletId: {
      type: Schema.Types.ObjectId,
      ref: 'Outlet',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    address: {
      province: { type: String, trim: true },
      regency: { type: String, trim: true },
      district: { type: String, trim: true },
      village: { type: String, trim: true },
      street: { type: String, trim: true },
      _id: false
    },
    _id: false
  },
  source: { // Origin of the inventory transaction
    sourceType: {
      type: String,
      enum: Object.values(SourceTypes),
      required: true,
    },
    ref: { // Reference to the source document (e.g., Sale.code, Purchase._id, Order.code)
      type: String,
      trim: true,
      required: true,
    },
    _id: false
  },
  transactionType: {
    type: String,
    enum: Object.values(TransactionTypes),
    required: true,
  },
  qty: { // Quantity of ingredient transacted (will be adjusted for sign in pre-save)
    type: Number,
    required: true,
    // No min/max here as sign will be handled
  },
  notes: {
    type: String,
    trim: true,
    default: null,
  },
  createdBy: { // User who initiated the transaction record
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    _id: false
  },
  evidenceUrl: { // URL to transaction evidence (image/PDF of receipt, form)
    type: String,
    trim: true,
    default: null,
  },
  isCalculated: { // Flag if this transaction's effect on inventory levels has been calculated
    type: Boolean,
    default: false,
  },
  calculatedAt: { // Timestamp when it was calculated
    type: Date,
    default: null,
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
OutletInventoryTransactionSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

// --- Pre-save hook for code generation and quantity sign adjustment ---
OutletInventoryTransactionSchema.pre('save', async function(next) {
  if (this.isNew) { // Only for new documents
    // --- Quantity Sign Adjustment ---
    switch (this.transactionType) {
      case TransactionTypes.IN:
        if (this.qty < 0) this.qty = Math.abs(this.qty); // Ensure positive
        break;
      case TransactionTypes.OUT:
      case TransactionTypes.SPOILAGE:
        if (this.qty > 0) this.qty = -Math.abs(this.qty); // Ensure negative
        break;
      case TransactionTypes.ADJUSTMENT:
        // Quantity can be positive or negative, so no sign adjustment needed here.
        // Validation for quantity will happen in the controller if needed.
        break;
      default:
        return next(new Error('Jenis transaksi tidak valid.')); // Should be caught by enum, but good safeguard
    }

    // --- Code Generation ---
    // Fetch the full Outlet document to get its code
    const OutletModel = mongoose.models.Outlet || mongoose.model('Outlet');
    const outletDoc = await OutletModel.findById(this.outlet.outletId);

    if (!outletDoc || !outletDoc.code) {
      return next(new Error('Outlet tidak ditemukan atau tidak memiliki kode untuk membuat kode transaksi inventori.'));
    }

    // Get the outlet's code suffix (last 3 chars or full code if shorter)
    const outletCodeSuffix = outletDoc.code.length <= 3 ? outletDoc.code.toUpperCase() : outletDoc.code.slice(-3).toUpperCase();

    const today = new Date();
    // Format date: YYMMDD (e.g., 250601)
    const formattedDate = `${String(today.getFullYear()).slice(-2)}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

    // Transaction type abbreviation
    const trxAbbr = TransactionTypeAbbreviations[this.transactionType];
    if (!trxAbbr) {
      return next(new Error('Gagal mendapatkan singkatan jenis transaksi.'));
    }

    // Counter ID combines date and outlet code suffix
    const counterId = `invtrx_${formattedDate}_${outletCodeSuffix}`;

    try {
      // Find and update the counter for today and this specific outlet.
      // Reset seq to 1 if it's a new day, otherwise increment.
      const counter = await InventoryTransactionCounter.findOneAndUpdate(
        { _id: counterId },
        { $inc: { seq: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // Final transaction code format: INVTRX<YYMMDD><OUTLETCODE_SUFFIX>-<3_DIGIT_SEQUENCE>-<TRX_ABBR>
      this.code = `INVTRX${formattedDate}${outletCodeSuffix}-${String(counter.seq).padStart(3, '0')}-${trxAbbr}`;

    } catch (error) {
      console.error('Kesalahan saat membuat kode transaksi inventori:', error);
      return next(new Error('Gagal membuat kode transaksi inventori. Silakan coba lagi.'));
    }
  }
  next();
});

// Pre-findOneAndUpdate hook for soft delete and isValid update
OutletInventoryTransactionSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();

  // Handle soft delete logic
  if (update && update.isDeleted === true) {
    if (!update.deletedAt) {
      update.deletedAt = new Date();
    }
    // `deletedBy` would typically be set from `req.user` in the controller before calling findByIdAndUpdate
  }

  // Handle isValid and validatedAt logic
  if (update && update.isValid === true) {
    if (!update.validatedAt) {
      update.validatedAt = new Date(); // Set validatedAt if isValid is set to true
    }
  } else if (update && update.isValid === false) {
    // If isValid is explicitly set to false, reset validatedAt
    update.validatedAt = null;
  }

  // If isCalculated is explicitly set to true, set calculatedAt
  if (update && update.isCalculated === true) {
    if (!update.calculatedAt) {
        update.calculatedAt = new Date();
    }
  } else if (update && update.isCalculated === false) {
    // If isCalculated is explicitly set to false, reset calculatedAt
    update.calculatedAt = null;
  }

  next();
});

export default model('OutletInventoryTransaction', OutletInventoryTransactionSchema);
