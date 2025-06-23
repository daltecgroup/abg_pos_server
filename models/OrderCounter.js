import { Schema, model } from 'mongoose';

const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
  lastResetDate: { type: Date, default: () => new Date(new Date().setHours(0,0,0,0)) }
});

export default model('OrderCounter', counterSchema);