import { Schema, model } from 'mongoose';
import Counter from './Counter.js';

const OutletSchema = new Schema({
  code: {
    type: String,
    trim: true,
    uppercase: true,
    unique: true,
    index: true, // Index for fast lookup by code
  },
  name: {
    type: String,
    required: true,
    unique: true, // Enforce unique outlet names
    trim: true,
    index: true, // Index for searching/sorting by name
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true,
  },
  franchisees: [ // List of User IDs who are franchisees for this outlet
    {
      type: Schema.Types.ObjectId,
      ref: 'User', // Reference to the User model
      required: true, // Each entry must reference a user
    }
  ],
  operators: [ // List of User IDs who are operators for this outlet
    {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    }
  ],
  spvAreas: [ // List of User IDs who are SPV Area for this outlet
    {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    }
  ],
  address: { // Embedded document for address details
    province: {
      type: String,
      required: true,
      trim: true,
    },
    regency: { // Kabupaten/Kota
      type: String,
      required: true,
      trim: true,
    },
    district: { // Kecamatan
      type: String,
      required: true,
      trim: true,
    },
    village: { // Kelurahan/Desa
      type: String,
      required: true,
      trim: true,
    },
    street: {
      type: String,
      required: true,
      trim: true,
    },
    _id: false // Prevents Mongoose from adding an _id to the embedded address object
  },
  imgUrl: {
    type: String,
    trim: true,
    default: null,
  },
  foundedAt: {
    type: Date,
    default: null, // Can be null if not specified
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
OutletSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

// --- Pre-save hook to generate automatic 'code' ---
OutletSchema.pre('save', async function(next) {
  if (this.isNew && !this.code) {
    try {
      const counter = await Counter.findOneAndUpdate(
        { _id: 'outletCode' }, // Identifier for this specific counter
        { $inc: { seq: 1 } },
        { upsert: true, new: true }
      );
      this.code = `OUTLET${String(counter.seq).padStart(3, '0')}`;
    } catch (error) {
      console.error('Error generating outlet code:', error);
      return next(new Error('Failed to generate outlet code.'));
    }
  }
  next();
});

// Pre-findOneAndUpdate hook for soft delete logic
OutletSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  if (update && update.isDeleted === true) {
    if (!update.deletedAt) {
      update.deletedAt = new Date();
    }
    // In a real application, you'd typically get the deletedBy user ID from the request context (e.g., req.user.id)
  }
  next();
});

export default model('Outlet', OutletSchema);
