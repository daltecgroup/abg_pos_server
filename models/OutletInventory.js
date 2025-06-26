import { Schema, model } from 'mongoose';

const OutletInventorySchema = new Schema({
  // Use outletId as the _id to ensure only one inventory document per outlet
  _id: {
    type: Schema.Types.ObjectId,
    ref: 'Outlet', // Reference to the Outlet model
  },
  // Array of ingredients currently in stock at this outlet
  ingredients: [
    {
      ingredientId: {
        type: Schema.Types.ObjectId,
        ref: 'Ingredient', // Reference to the Ingredient model
        required: true,
      },
      currentQty: {
        type: Number,
        required: true,
        min: 0, // Quantity should not go below zero for physical stock
        default: 0,
      },
      // Snapshots of ingredient details for quick reference
      name: { type: String, trim: true, default: null },
      unit: { type: String, trim: true, default: null },
      price: { type: Number, min: 0, default: 0 }, // Price at last update/sync

      // Optional: Store last time this specific ingredient's quantity was updated
      lastQuantityUpdated: {
        type: Date,
        default: Date.now,
      },
      _id: false, // Prevents Mongoose from adding a sub-document _id to each ingredient item
    },
  ],

  // General fields for the inventory document itself
  lastSyncedAt: { // Timestamp when this inventory document was last updated by a transaction
    type: Date,
    default: Date.now,
  },
  lastSyncedBy: { // User who triggered the last sync (e.g., via a transaction)
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    userName: { type: String, default: 'System', trim: true },
    _id: false,
  },

  isDeleted: { // For soft-deleting the entire inventory record for an outlet (if outlet is deleted)
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
  timestamps: true, // Adds createdAt and updatedAt for the inventory document itself
  toJSON: {
    virtuals: true,
    getters: true,
    transform: (doc, ret) => {
      delete ret.__v;
      // Convert _id to 'id' (which is the outletId)
      ret.id = ret._id.toHexString();
      delete ret._id;
      return ret;
    }
  },
  toObject: {
    virtuals: true,
    getters: true,
  }
});

// Virtual for id (already handled in transform, but good for direct object access)
OutletInventorySchema.virtual('id').get(function () {
  return this._id.toHexString();
});


// Pre-findOneAndUpdate hook for soft delete logic
OutletInventorySchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  if (update && update.isDeleted === true) {
    if (!update.deletedAt) {
      update.deletedAt = new Date();
    }
    // You'd typically get deletedBy from req.user context passed via controller/service
  }
  next();
});

const OutletInventory = model('OutletInventory', OutletInventorySchema);

export default OutletInventory;
