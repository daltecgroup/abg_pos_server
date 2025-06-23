import { Schema, model } from 'mongoose';
import Counter from './Counter.js';

const AddonSchema = new Schema({
  code: {   
    type: String,
    trim: true,
    uppercase: true,
    index: true, // Index for fast lookup by code
  },
  name: {
    type: String,
    required: true,
    unique: true, // Enforce unique addon names
    trim: true,
    index: true, // Index for searching/sorting by name
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  // If addons also have ingredients (like a topping requiring specific ingredients),
  // you might add a 'recipe' field similar to the Menu model:
  recipe: [
    {
      ingredientId: { type: Schema.Types.ObjectId, ref: 'Ingredient', required: true },
      qty: { type: Number, required: true, min: 0 },
      _id: false
    }
  ],
  imgUrl: {
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
AddonSchema.virtual('id').get(function () {
  return this._id.toHexString();
});


// --- Pre-save hook to generate automatic 'code' ---
AddonSchema.pre('save', async function(next) {
  if (this.isNew && !this.code) {
    try {
      const counter = await Counter.findOneAndUpdate(
        { _id: 'addonCode' }, // Identifier for this specific counter
        { $inc: { seq: 1 } },
        { upsert: true, new: true }
      );
      this.code = `ADDON${String(counter.seq).padStart(3, '0')}`;
    } catch (error) {
      console.error('Error generating addon code:', error);
      return next(new Error('Failed to generate addon code.'));
    }
  }
  next();
});

// Pre-findOneAndUpdate hook for soft delete logic
AddonSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  if (update && update.isDeleted === true) {
    if (!update.deletedAt) {
      update.deletedAt = new Date();
    }
    // In a real application, you'd typically get the deletedBy user ID from the request context (e.g., req.user.id)
  }
  next();
});

export default model('Addon', AddonSchema);
