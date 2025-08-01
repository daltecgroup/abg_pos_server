import mongoose, { Schema, model } from 'mongoose';

/**
 * @fileoverview Defines the Mongoose schema and model for UserOutlet.
 * This model is designed to track which outlet a user is currently accessing.
 * It uses the user's ObjectId as its own _id to ensure a single record per user.
 */

// --- UserOutlet Schema Definition ---
const UserOutletSchema = new Schema(
  {
    // The _id field is explicitly defined as a reference to the User model.
    // This makes the user's ID the primary key for this document, ensuring uniqueness.
    _id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      // The `ref` property creates a link to the 'User' model.
    },
    
    // The currentOutlet field stores the ObjectId of the last outlet the user accessed.
    currentOutlet: {
      type: Schema.Types.ObjectId,
      ref: 'Outlet',
      required: true,
    },
  },
  {
    // The `timestamps: true` option adds `createdAt` and `updatedAt` fields automatically.
    // This is useful for knowing when the record was first created and when it was last modified.
    timestamps: true,
  }
);

// --- Model Export ---
// Check if the model has already been defined to prevent re-compilation issues in development.
const UserOutlet = mongoose.models.UserOutlet || mongoose.model('UserOutlet', UserOutletSchema);

export default UserOutlet;
