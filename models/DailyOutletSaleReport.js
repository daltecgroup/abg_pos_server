import { Schema, model } from 'mongoose';

const DailyOutletSaleReportSchema = new Schema({
  // Compound _id to ensure one report per outlet per day
  _id: {
    type: String, // Format: `${outletId}_${YYMMDD}`
    required: true,
    unique: true,
    // Removed 'index: true' as _id is automatically indexed by MongoDB
  },
  outlet: { // Snapshot of outlet details
    outletId: {
      type: Schema.Types.ObjectId,
      ref: 'Outlet',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true }, // Include outlet code for easier identification
    _id: false,
  },
  date: { // The date of the report (start of day, UTC)
    type: Date,
    required: true,
    set: (v) => v ? new Date(new Date(v).setUTCHours(0, 0, 0, 0)) : v,
    get: (v) => v ? new Date(v).toISOString().split('T')[0] : v, // Return as 'YYYY-MM-DD' string
  },
  // Aggregated items sold for the day
  itemSold: [
    {
      itemId: { // Can be Menu ID, Bundle ID, or Addon ID
        type: Schema.Types.ObjectId,
        required: true,
      },
      name: { type: String, required: true, trim: true },
      qtySold: { type: Number, required: true, min: 0 },
      totalRevenue: { type: Number, required: true, min: 0 }, // Revenue contributed by this item type
      type: { // 'menu_single', 'bundle', 'addon', 'menu_promo'
        type: String,
        enum: ['menu_single', 'bundle', 'addon', 'menu_promo'],
        required: true,
      },
      _id: false,
    }
  ],
  totalSale: { // Total revenue for the day from all sales
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
  totalExpense: { // Total expense for the day based on ingredientUsed
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
  saleComplete: { // NEW: Count of completed sales for the day
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
}, {
  timestamps: true, // Adds createdAt and updatedAt
  toJSON: {
    virtuals: true,
    getters: true,
    transform: (doc, ret) => {
      delete ret.__v;
      delete ret._id;
      // The _id is already the report code, so no need for a separate 'id' virtual
      return ret;
    }
  },
  toObject: {
    virtuals: true,
    getters: true,
  }
});

// Ensure date is stored as start of day for consistent querying
DailyOutletSaleReportSchema.index({ 'outlet.outletId': 1, date: 1 }, { unique: true });


export default model('DailyOutletSaleReport', DailyOutletSaleReportSchema);
