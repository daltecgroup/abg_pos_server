import { connect } from 'mongoose';
import PromoSetting from '../models/PromoSetting.js';

const connectDB = async () => {
  try {
    const conn = await connect(process.env.DATABASE_URL);
    console.log(`MongoDB Connected: ${conn.connection.host}`, new Date().toLocaleString());
    PromoSetting.initializePromoSettings();
    
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1); // Exit process with failure
  }
};

export default connectDB;