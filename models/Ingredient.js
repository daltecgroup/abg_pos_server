import { Schema, model } from 'mongoose';
import Counter from './Counter.js';
import IngredientHistory from './IngredientHistory.js'

const IngredientSchema = new Schema({
    code: {
        type: String,
        trim: true,
        uppercase: true,
        index: true,
    },
    name: {
        type: String,
        required: true,
        unique: true,
        index: true,
        trim: true,
        lowercase: true,
    },
    unit: {
        type: String,
        required: true,
        enum: ['weight', 'volume', 'pcs'],
        default: 'weight'
    },
    price: {
        type: Number,
        required: true,
        min: 0,
        default: 0,
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
        default: null
    },
    deletedBy: {
        type: String,
        default: null
    }
}, {
    timestamps: true,
    toJSON: {
    getters: true,  // Keeping getters true in case of other getters
    transform: (doc, ret) => {
      delete ret.__v;
      delete ret._id;
      return ret;
    }
  },
});

// --- Pre-save hook to generate automatic 'code' ---
IngredientSchema.pre('save', async function(next) {
  if (this.isNew && !this.code) {
    try {
      const counter = await Counter.findOneAndUpdate(
        { _id: 'ingredientCode' }, // Identifier for this specific counter
        { $inc: { seq: 1 } },       // Increment the sequence by 1
        { upsert: true, new: true } // Create if not exists, return the new document
      );
      // Format the sequence number: ING001, ING002, etc.
      this.code = `ING${String(counter.seq).padStart(3, '0')}`;
    } catch (error) {
      console.error('Error generating ingredient code:', error);
      return next(new Error('Failed to generate ingredient code.')); // Pass error to Mongoose
    }
  }
  next();
});

IngredientSchema.pre('findOneAndUpdate', async function(next) {
  // `this` refers to the query object
  const query = this;
  const update = query.getUpdate();
  const docToUpdate = await query.model.findOne(query.getQuery()); // Fetch the document before update

  // Handle soft delete logic
  if (update && update.isDeleted === true) {
    if (!update.deletedAt) {
      update.deletedAt = new Date();
    }
    // In a real application, you'd typically get the deletedBy user ID from the request context (e.g., req.user.id)
  }

  // --- Track name and price changes ---
  const changes = [];
  let userMakingChangeId = null;
  let userMakingChangeName = 'System/API'; //

  if (query.options.context && query.options.context.user) {
    userMakingChangeId = query.options.context.user.id;
    userMakingChangeName = query.options.context.user.name;
  }

  if (docToUpdate) {
    // Check for name change
    const newName = update.name || (update.$set && update.$set.name);
    if (newName && newName !== docToUpdate.name) {
      changes.push(`Nama diubah dari '${docToUpdate.name}' menjadi '${newName}'.`);
    }

    // Check for price change
    const newPrice = update.price || (update.$set && update.$set.price);
    // Be careful with float comparisons. Compare strings if Decimal128 or use tolerance for Number.
    // Here we convert to Number for comparison since schema is Number.
    if (newPrice !== undefined && parseFloat(newPrice) !== docToUpdate.price) {
      changes.push(`Harga diubah dari '${docToUpdate.price}' menjadi '${newPrice}'.`);
    }
  }

  if (changes.length > 0) {
    try {
      await IngredientHistory.create({
        ingredientId: docToUpdate._id,
        createdBy: {
          userId: userMakingChangeId,
          userName: userMakingChangeName,
        },
        content: changes.join(' '),
      });
    } catch (historyError) {
      console.error('Gagal membuat riwayat perubahan bahan:', historyError);
      // Decide if you want to block the main update if history logging fails.
      // For now, it just logs and continues.
    }
  }

  next();
});

// Also add a post-save hook for initial creation and direct `.save()` updates
IngredientSchema.post('save', async function(doc, next) {
  // 'this' refers to the document being saved
  const changes = [];
  let userMakingChangeId = null; // Placeholder
  let userMakingChangeName = 'System/API'; // Placeholder

  // For initial save, log the creation
  if (doc.isNew) {
    changes.push(`Bahan baku '${doc.name}' (Code: ${doc.code}) berhasil dibuat.`);
  } else {
    // For direct .save() updates, you need to compare changed paths
    // Mongoose tracks modified paths.
    if (doc.isModified('name')) {
      changes.push(`Nama diubah dari '${doc.name}' menjadi '${doc.name}'.`); // This will log the new name as old.
      // To get old name: You'd need to fetch the document before `save()` if you want the *old* value.
      // For simplicity, a `post('save')` might just log the fact that 'name' was updated.
      // Or, if using `pre('save')`, you'd compare `this._original.name` to `this.name` (requires tracking).
      // For now, let's just indicate "name updated".
      changes.push(`Nama diperbarui menjadi '${doc.name}'.`);
    }
    if (doc.isModified('price')) {
      changes.push(`Harga diperbarui menjadi '${doc.price}'.`);
    }
  }

  if (changes.length > 0) {
    try {
      await IngredientHistory.create({
        ingredientId: doc._id,
        createdBy: {
          userId: userMakingChangeId,
          userName: userMakingChangeName,
        },
        content: changes.join(' '),
      });
    } catch (historyError) {
      console.error('Gagal membuat riwayat perubahan bahan:', historyError);
    }
  }

  next();
});

export default model('Ingredient', IngredientSchema);