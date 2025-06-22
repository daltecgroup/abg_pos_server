import { Schema, model } from 'mongoose';
import Counter from './Counter.js';

const BundleSchema = new Schema({
  code: {
    type: String,
    trim: true,
    uppercase: true,
    index: true, // Index for fast lookup by code
  },
  name: {
    type: String,
    required: true,
    unique: false,
    trim: true,
    index: true, // Index for searching/sorting by name
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  categories: [ // Array of objects defining menus from specific categories
    {
      menuCategoryId: {
        type: Schema.Types.ObjectId,
        ref: 'MenuCategory', // Reference to MenuCategory model
        required: true,
      },
      qty: { // How many menus from this category are included in the bundle
        type: Number,
        required: true,
        min: 1, // Must include at least one menu from the specified category
      },
      _id: false // Prevents Mongoose from adding an _id to each subdocument in the array
    }
  ],
  description: {
    type: String,
    trim: true,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true,
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
BundleSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

// --- Pre-save hook to generate automatic 'code' ---
BundleSchema.pre('save', async function(next) {
  if (this.isNew && !this.code) {
    try {
      const counter = await Counter.findOneAndUpdate(
        { _id: 'bundleCode' }, // Identifier for this specific counter
        { $inc: { seq: 1 } },
        { upsert: true, new: true }
      );
      this.code = `BUNDLE${String(counter.seq).padStart(3, '0')}`;
    } catch (error) {
      console.error('Error generating bundle code:', error);
      return next(new Error('Failed to generate bundle code.'));
    }
  }
  next();
});

// Pre-findOneAndUpdate hook for soft delete logic
BundleSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  if (update && update.isDeleted === true) {
    if (!update.deletedAt) {
      update.deletedAt = new Date();
    }
    // In a real application, you'd typically get the deletedBy user ID from the request context (e.g., req.user.id)
  }
  next();
});

export default model('Bundle', BundleSchema);
