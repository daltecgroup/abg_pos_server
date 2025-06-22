import { Schema, model } from 'mongoose';
import { Roles } from '../constants/roles.js';
import bcrypt from 'bcrypt';

const hashPasword = async (password) => {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(password, salt);
}

const UserSchema = new Schema({
    userId: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    roles: [
        {
            type: String,
            enum: Object.values(Roles),
            required: true,
        }
    ],
    password: {
        type: String,
        required: true,
        minLength: 4,
    },
    imgUrl: {
        type: String,
        default: null,
        trim: true,
    },
    phone: {
        type: String,
        default: null,
        trim: true,
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    isDeleted: {
        type: Boolean,
        default: false,
        index: true
    },
    deletedAt: {
        type: Date,
        default: null
    },
    deletedBy: {
        type: String,
        default: null
    }
}, {
    timestamps: true
});

// Pre-save hook to hash password before saving
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    next();
  }
  this.password = await hashPasword(this.password);
  next();
});

UserSchema.pre('findOneAndUpdate', async function(next) {
  const update = this.getUpdate();
  if(update.phone == ''){
    update.phone = null;
  }
  if (update.password) {
    update.password = await hashPasword(update.password);
  }
  // Handle soft delete logic during update
  if (update && update.isDeleted === true) {
    if (!update.deletedAt) {
      update.deletedAt = new Date(); // Set deletion timestamp
    }
  }
  next();
});

// Method to compare passwords
UserSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

export default model('User', UserSchema);