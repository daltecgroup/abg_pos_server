import mongoose, { Schema, model } from 'mongoose';
import { PaymentMethods } from '../constants/paymentMethods.js'; // Import PaymentMethods enum
import { updateDailySaleReport } from '../services/dailySaleReportService.js';

// --- Counter Schema for Sale Codes with Daily & Outlet-Specific Reset ---
// This counter needs to track sequence per day AND per outlet.
const SaleCounterSchema = new Schema({
  _id: { type: String, required: true }, // Format: 'sale_YYMMDD_OUTLETCODESUFFIX'
  seq: { type: Number, default: 0 },
});
const SaleCounter = mongoose.models.SaleCounter || mongoose.model('SaleCounter', SaleCounterSchema); // Use existing model if already defined

const SaleSchema = new Schema({
  code: {
    type: String,
    trim: true,
    uppercase: true,
    index: true,
    unique: true, // Sale code must be unique
  },
  isValid: { // To mark a sale as invalid (e.g., for returns/cancellations) without deleting
    type: Boolean,
    default: true,
  },
  outlet: { // Embedded document: Snapshot of outlet details at time of sale
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
      _id: false // Prevents Mongoose from adding an _id to the embedded address object
    },
    _id: false
  },
  operator: { // Embedded document: Snapshot of operator details at time of sale
    operatorId: {
      type: Schema.Types.ObjectId,
      ref: 'User', // Assuming User model has roles and name
      required: true,
    },
    name: { type: String, required: true, trim: true },
    _id: false
  },
  itemSingle: [ // Array of single menu items sold
    {
      menuId: {
        type: Schema.Types.ObjectId,
        ref: 'Menu',
        required: true,
      },
      name: { type: String, required: true, trim: true },
      qty: { type: Number, required: true, min: 1 },
      price: { type: Number, required: true, min: 0 }, // Price at time of sale
      discount: { type: Number, min: 0, max: 100, default: 0 }, // Discount specific to this item in this sale
      notes: { type: String, trim: true, default: null },
      addons: [ // Nested array of addons applied to this specific single item
        {
          addonId: {
            type: Schema.Types.ObjectId,
            ref: 'Addon',
            required: true,
          },
          name: { type: String, required: true, trim: true },
          qty: { type: Number, required: true, min: 1 },
          price: { type: Number, required: true, min: 0 }, // Price at time of sale
          _id: false
        }
      ],
      _id: false
    }
  ],
  itemBundle: [ // Array of menu bundles sold
    {
      menuBundleId: {
        type: Schema.Types.ObjectId,
        ref: 'Bundle',
        required: true,
      },
      name: { type: String, required: true, trim: true },
      qty: { type: Number, required: true, min: 1 },
      price: { type: Number, required: true, min: 0 }, // Price of the bundle at time of sale
      // This 'items' array captures the specific menus chosen within this bundle instance.
      // If a bundle means "get X from Category A, Y from Category B", these are the choices.
      items: [
        {
          menuId: {
            type: Schema.Types.ObjectId,
            ref: 'Menu',
            required: true,
          },
          name: { type: String, required: true, trim: true },
          qty: { type: Number, required: true, min: 1 }, // Quantity of this specific menu within the bundle
          price: { type: Number, required: true, min: 0 }, // Price of this menu (likely 0 or adjusted as part of bundle deal)
          _id: false
        }
      ],
      _id: false
    }
  ],
  itemPromo: [ // Array of menu items given as part of a promotion (e.g., free items)
    {
      menuId: {
        type: Schema.Types.ObjectId,
        ref: 'Menu',
        required: true,
      },
      name: { type: String, required: true, trim: true },
      qty: { type: Number, required: true, min: 1 }, // Quantity of the promo item
      _id: false
    }
  ],
  itemAddon: [ // [BARU] Array untuk Addon yang dijual terpisah (Standalone)
    {
      addonId: {
        type: Schema.Types.ObjectId,
        ref: 'Addon',
        required: true,
      },
      name: { type: String, required: true, trim: true },
      qty: { type: Number, required: true, min: 1 },
      price: { type: Number, required: true, min: 0 }, // Harga saat transaksi
      _id: false
    }
  ],
  totalPrice: { // Total calculated price of the entire sale
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
  totalPaid: { // Amount received from customer
    type: Number,
    required: true,
    min: 0,
  },
  payment: { // Payment details
    method: {
      type: String,
      enum: Object.values(PaymentMethods), // Using enum from constants file
      required: true,
    },
    evidenceUrl: { // URL for payment evidence (e.g., transfer screenshot, QRIS capture)
      type: String,
      trim: true,
      default: null,
    },
    _id: false
  },
  invoicePrintHistory: [ // Array of who printed the invoice and when
    {
      userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
      printedAt: {
        type: Date,
        default: Date.now,
      },
      _id: false
    }
  ],
  // NEW: ingredientUsed array
  ingredientUsed: [
    {
      ingredientId: {
        type: Schema.Types.ObjectId,
        ref: 'Ingredient',
        required: true,
      },
      name: { // Snapshot of ingredient name (can be null if original ingredient is deleted/not found)
        type: String,
        default: null,
        trim: true
      },
      qty: { // Total quantity of this ingredient used in the sale
        type: Number,
        required: true,
        min: 0
      },
      expense: { // Total expense for this ingredient based on its price at time of sale
        type: Number,
        required: true,
        min: 0
      },
      unit: { // Snapshot of ingredient unit
        type: String,
        default: null,
        trim: true
      },
      _id: false
    }
  ],
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
    ref: 'User', // Only admin can delete permanently
    default: null,
  },
}, {
  timestamps: true, // Adds createdAt and updatedAt
  toJSON: {
    virtuals: true,
    getters: true,
    transform: (doc, ret) => {
      delete ret.__v;
      delete ret._id; // _id is transformed to 'id' virtual
      return ret;
    }
  },
  toObject: {
    virtuals: true,
    getters: true,
  }
});

// Virtual for id
SaleSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

// --- Pre-save hook to generate automatic 'code' (SALE + YYMMDD + outletcode + 3 digit counter) ---
SaleSchema.pre('save', async function(next) {
  if (this.isNew) { // Only generate code for new documents
    // NEW: Fetch the full Outlet document to get its code
    const OutletModel = mongoose.models.Outlet || mongoose.model('Outlet');
    const outletDoc = await OutletModel.findById(this.outlet.outletId);

    if (!outletDoc || !outletDoc.code) {
      return next(new Error('Outlet tidak ditemukan atau tidak memiliki kode untuk membuat kode penjualan.'));
    }

    // Get the outlet's code. Use the full code if it's 3 chars or less, otherwise last 3 chars.
    // Assuming outlet.code is always at least 3 characters or can be used as is.
    const outletCodeSuffix = outletDoc.code.length <= 3 ? outletDoc.code.toUpperCase() : outletDoc.code.slice(-3).toUpperCase();

    const today = new Date();
    // Format date for counter ID: YYMMDD (e.g., 240623)
    const formattedDate = `${String(today.getFullYear()).slice(-2)}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

    // Counter ID combines date and outlet code suffix
    const counterId = `sale_${formattedDate}_${outletCodeSuffix}`;

    try {
      // Find and update the counter for today and this specific outlet.
      // Reset seq to 1 if it's a new day, otherwise increment.
      const counter = await SaleCounter.findOneAndUpdate(
        { _id: counterId },
        { $inc: { seq: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // Final sale code format: SALE + YYMMDD + OUTLETCODESUFFIX + 3 DIGIT COUNTER
      this.code = `SALE${formattedDate}${outletCodeSuffix}${String(counter.seq).padStart(3, '0')}`;

    } catch (error) {
      console.error('Kesalahan saat membuat kode penjualan:', error);
      return next(new Error('Gagal membuat kode penjualan. Silakan coba lagi.'));
    }
  }
  next();
});

// Pre-findOneAndUpdate hook for soft delete logic
SaleSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  if (update && update.isDeleted === true) {
    if (!update.deletedAt) {
      update.deletedAt = new Date();
    }
    // In a real application, you'd typically get the deletedBy user ID from the request context (e.g., req.user.id)
  }
  next();
});

// NEW: Post-save hook to update the daily sales report
SaleSchema.post('save', async function(doc, next) {
  // 'doc' is the sale document that was just saved
  try {
    await updateDailySaleReport(doc);
  } catch (error) {
    console.error(`Error in Sale post-save hook updating daily report for sale ${doc.code}:`, error);
    // Decide if you want to block the sale save if daily report update fails.
    // For now, it just logs and continues.
  }
  next();
});

export default model('Sale', SaleSchema);
