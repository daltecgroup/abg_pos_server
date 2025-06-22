import { Schema, model } from 'mongoose';

// --- Counter Schema for Auto-Incrementing Codes ---
const counterSchema = new Schema({
  _id: { type: String, required: true }, // e.g., 'ingredientCode'
  seq: { type: Number, default: 0 },   // The current sequence number
  lastResetDate: { type: Date, default: () => new Date(new Date().setHours(0,0,0,0)) } // Stores the date of the last reset
});
export default model('Counter', counterSchema);