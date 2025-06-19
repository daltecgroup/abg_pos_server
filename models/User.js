import { Schema, model } from 'mongoose';
import { Roles } from '../constants/roles.js';
import bcrypt from 'bcrypt';

const UserSchema = new Schema({
    userId: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    roles: [
        {
            type: String,
            enum: Object.values(Roles),
            default: Roles.operator
        }
    ],
    password: {
        type: String,
        required: true
    },
    imgUrl: {
        type: String,
        default: null,
    },
    phone: {
        type: String,
        default: null
    },
    isActive: {
        type: Boolean,
        default: true
    },
    isDeleted: {
        type: Boolean,
        default: false
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

const hashPasword = async (password) => {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(password, salt);
}

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
  next();
});

// Method to compare passwords
UserSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

export default model('User', UserSchema);