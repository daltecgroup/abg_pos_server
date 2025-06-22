import { Schema, model } from 'mongoose';
import Counter from './Counter.js';

const MenuSchema = new Schema({
  code: {
    type: String,
    trim: true,
    uppercase: true,
    index: true, // Index for fast lookup by code
  },
  name: {
    type: String,
    required: true,
    unique: true, // Enforce unique menu names
    trim: true,
    index: true, // Index for searching/sorting by name
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  discount: { // Percentage discount (0-100)
    type: Number,
    min: 0,
    max: 100,
    default: 0,
  },
  description: {
    type: String,
    trim: true,
    default: null,
  },
  imgUrl: {
    type: String,
    trim: true,
    default: null,
  },
  category: {
    type: Schema.Types.ObjectId,
    ref: 'MenuCategory', // Reference to MenuCategory model
    required: true,
    index: true, // Index for filtering by category
  },
  ingredients: [ // Array of ingredient sub-documents
    {
      ingredientId: {
        type: Schema.Types.ObjectId,
        ref: 'Ingredient', // Reference to Ingredient model
        required: true,
      },
      qty: {
        type: Number,
        required: true,
        min: 0,
      },
      _id: false // Prevents Mongoose from adding an _id to each subdocument in the array
    }
  ],
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
      return ret;
    }
  },
  toObject: {
    virtuals: true,
    getters: true,
  }
});

// Virtual for id
MenuSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

// --- Pre-save hook to generate automatic 'code' ---
MenuSchema.pre('save', async function(next) {
  if (this.isNew && !this.code) {
    try {
      const counter = await Counter.findOneAndUpdate(
        { _id: 'menuCode' }, // Identifier for this specific counter
        { $inc: { seq: 1 } },
        { upsert: true, new: true }
      );
      this.code = `MENU${String(counter.seq).padStart(3, '0')}`;
    } catch (error) {
      console.error('Error generating menu code:', error);
      return next(new Error('Failed to generate menu code.'));
    }
  }
  next();
});

// Pre-findOneAndUpdate hook for soft delete logic
MenuSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  if (update && update.isDeleted === true) {
    if (!update.deletedAt) {
      update.deletedAt = new Date();
    }
    // In a real application, you'd typically get the deletedBy user ID from the request context (e.g., req.user.id)
  }
  next();
});

export default model('Menu', MenuSchema);
