import mongoose, { Schema, model } from 'mongoose';

const AttendanceSchema = new Schema({
  outlet: { // The outlet where the operator is clocking in/out
    type: Schema.Types.ObjectId,
    ref: 'Outlet',
    required: true,
  },
  operator: { // The operator user creating this attendance record
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  date: { // The date of the attendance (for daily unique constraint)
    type: Date,
    required: true,
    // Store only the date part (start of day)
    set: (v) => v ? new Date(new Date(v).setUTCHours(0, 0, 0, 0)) : v,
    get: (v) => v ? new Date(v).toISOString().split('T')[0] : v, // Return as 'YYYY-MM-DD' string for display
  },
  timeIn: { // Clock-in time
    type: Date,
    required: true,
  },
  timeInEvidence: { // Evidence for clock-in (e.g., image URL)
    type: String,
    required: true,
    trim: true,
  },
  // REMOVED: timeInLocation
  timeOut: { // Clock-out time
    type: Date,
    default: null,
  },
  timeOutEvidence: { // Evidence for clock-out
    type: String,
    trim: true,
    default: null,
  },
  // REMOVED: timeOutLocation
  createdBy: { // Who created/last updated the record (e.g., the operator themselves)
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    userName: {
      type: String,
      required: true,
      trim: true
    },
    _id: false
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
    ref: 'User',
    default: null,
  },
}, {
  timestamps: true, // Adds createdAt and updatedAt
  toJSON: {
    virtuals: true,
    getters: true, // Apply getter for 'date' field
    transform: (doc, ret) => {
      delete ret.__v;
      return ret;
    }
  },
  toObject: {
    virtuals: true,
    getters: true, // Apply getter for 'date' field
  }
});

// Virtual for id
AttendanceSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

// --- Unique Compound Index: Ensure one attendance record per operator per day ---
AttendanceSchema.index(
  { operator: 1, date: 1 },
  {
    unique: true,
    // Mongoose automatically uses a default collation if not specified,
    // which is usually fine for Date equality.
    // However, ensure your MongoDB connection URL has `retryWrites=true`
    // for robust unique index handling in distributed environments.
  }
);

// Pre-findOneAndUpdate hook for soft delete logic (and potentially other updates)
AttendanceSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  if (update && update.isDeleted === true) {
    if (!update.deletedAt) {
      update.deletedAt = new Date();
    }
    // You would typically get the deletedBy user ID from the request context (e.g., req.user.id)
  }
  next();
});

export default model('Attendance', AttendanceSchema);
