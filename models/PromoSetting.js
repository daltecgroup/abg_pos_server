// models/PromoSetting.js

import mongoose, { Schema, model } from 'mongoose';

// Define the allowed promo codes as an enum
export const PromoCodes = {
  PROMO_BUY_GET: 'promo_buy_get',
  PROMO_SPEND_GET: 'promo_spend_get',
};

const PromoSettingSchema = new Schema({
  // Using 'code' as _id to enforce uniqueness and limit to specific records
  _id: {
    type: String,
    required: true,
    enum: Object.values(PromoCodes), // Restrict to only the defined promo codes
    // Removed 'index: true' as _id is automatically indexed by MongoDB
  },
  nominal: { // For 'buy X get Y', this is X. For 'spend X get Y free', this is X.
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
  bonusMaxPrice: { // Max price of the bonus item (Y)
    type: Number,
    min: 0,
    default: 0,
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: { // Changed 'desc' to 'description' for clarity
    type: String,
    trim: true,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true, // Adds createdAt and updatedAt
  toJSON: {
    virtuals: true,
    transform: (doc, ret) => {
      delete ret.__v;
      // When converting to JSON, rename _id to code for consistency with API
      ret.code = ret._id;
      delete ret._id;
      return ret;
    }
  },
  toObject: {
    virtuals: true,
  }
});

// Virtual for id
PromoSettingSchema.virtual('id').get(function () {
  return this._id; // 'id' will return the same value as 'code'
});

// --- Static method to initialize default promo settings ---
PromoSettingSchema.statics.initializePromoSettings = async function () {
  console.log('Initializing default promo settings...');
  const defaultSettings = [
    {
      _id: PromoCodes.PROMO_BUY_GET,
      nominal: 2, // Default: Buy 2
      bonusMaxPrice: 0, // Default: Get free item with max price 0
      title: 'Beli X Gratis Y',
      description: 'Promo beli sejumlah item tertentu gratis item lainnya.',
      isActive: true,
    },
    {
      _id: PromoCodes.PROMO_SPEND_GET,
      nominal: 50000, // Default: Spend 50,000
      bonusMaxPrice: 0, // Default: Get free item with max price 0
      title: 'Belanja X Gratis Y',
      description: 'Promo belanja dengan total nominal tertentu gratis item.',
      isActive: true,
    },
  ];

  for (const setting of defaultSettings) {
    try {
      // Find and update, or create if not found.
      // We use findOneAndUpdate with upsert: true to ensure it's created if it doesn't exist
      // and updated if it does.
      await this.findOneAndUpdate(
        { _id: setting._id },
        { $setOnInsert: setting }, // Only set these fields on insert
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      console.log(`Promo setting '${setting._id}' ensured.`);
    } catch (error) {
      console.error(`Error ensuring promo setting '${setting._id}':`, error);
    }
  }
  console.log('Default promo settings initialization complete.');
};

// --- Prevent deletion of promo settings ---
// Using a pre-hook for deleteOne and deleteMany
PromoSettingSchema.pre('deleteOne', { document: false, query: true }, async function(next) {
  const filter = this.getQuery();
  // If a specific _id is being targeted, prevent deletion
  if (filter && (filter._id === PromoCodes.PROMO_BUY_GET || filter._id === PromoCodes.PROMO_SPEND_GET)) {
    return next(new Error('Deletion of core promo settings is not allowed.'));
  }
  next();
});

PromoSettingSchema.pre('deleteMany', { document: false, query: true }, async function(next) {
  const filter = this.getQuery();
  // If trying to delete all or specific core promo settings
  if (!filter || Object.keys(filter).length === 0 || filter._id === PromoCodes.PROMO_BUY_GET || filter._id === PromoCodes.PROMO_SPEND_GET) {
    return next(new Error('Deletion of core promo settings is not allowed.'));
  }
  next();
});

export default model('PromoSetting', PromoSettingSchema);
