// models/IngredientHistory.js

import { Schema, model } from 'mongoose';

const IngredientHistorySchema = new Schema({
  ingredientId: {
    type: Schema.Types.ObjectId,
    ref: 'Ingredient', // Reference to the Ingredient document
    required: true,
    index: true, // Index for quick lookup of history by ingredient
  },
  createdBy: { // Who made the change
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User', // Reference to the User model (if you have one)
      default: null, // Can be null if changes are system-generated or user not logged in
    },
    userName: {
      type: String,
      default: 'System', // Default name for changes not attributed to a specific user
    },
  },
  content: { // Penjelasan tentang apa yang berubah
    type: String,
    required: true,
    trim: true,
  },
}, {
  timestamps: { createdAt: true, updatedAt: false }, // Only createdAt is needed for history
  toJSON: {
    virtuals: true,
    transform: (doc, ret) => {
      delete ret.__v;
      delete ret._id;
      return ret;
    }
  },
  toObject: {
    virtuals: true,
  }
});

// Virtual for id
IngredientHistorySchema.virtual('id').get(function () {
  return this._id.toHexString();
});

export default model('IngredientHistory', IngredientHistorySchema);
