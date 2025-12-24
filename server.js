import express, { json } from 'express';
import logger from './middleware/logger.js';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import connectDB from './config/db.js';
import path from 'path';

// import custom modules
import addressRoutes from './routes/addressRoutes.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import ingredientRoutes from './routes/ingredientRoutes.js';
import menuCategoryRoutes from './routes/menuCategoryRoutes.js';
import menuRoutes from './routes/menuRoutes.js';
import addonRoutes from './routes/addonRoutes.js';
import outletRoutes from './routes/outletRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import bundleRoutes from './routes/bundleRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import saleRoutes from './routes/saleRoutes.js';
import outletInventoryTransactionRoutes from './routes/outletInventoryTransactionRoutes.js';
import outletInventoryRoutes from './routes/outletInventoryRoutes.js';
import dataInitRoutes from './routes/dataInitRoutes.js';
import dailySaleReportRoutes from './routes/dailySaleReportRoutes.js';
import promoSettingRoutes from './routes/promoSettingRoutes.js'; // NEW: Import promo setting routes
import DailyOutletSaleReport from './models/DailyOutletSaleReport.js'; // NEW: Import DailyOutletSaleReport model
import userOutletRoutes from './routes/userOutletRoutes.js';
import serviceRequestRoutes from './routes/serviceRequestRoutes.js';
import adminNotificationRoutes from './routes/adminNotificationRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for development. Restrict in production.
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// Connect Database
connectDB();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended: true }));
app.use(logger);


// Setup Socket.IO
// setupSocket(io);

// Serve static files from the 'uploads' directory
app.use('/uploads/attendance/evidence', express.static(path.join('uploads', 'attendance', 'evidence'))); // Updated to specifically point to the correct sub-directory

// Payment evidence files: accessible via /uploads/payment/evidence/filename.webp or .pdf
app.use('/uploads/payment/evidence', express.static(path.join('uploads', 'payment', 'evidence'))); // MODIFIED: Path changed
app.use('/uploads/inventory_evidence', express.static(path.join('uploads', 'inventory_evidence')));
app.use('/uploads/user', express.static(path.join('uploads', 'user')));
app.use('/uploads/menu', express.static(path.join('uploads', 'menu')));

// Routes
app.use('/api/v1/address', addressRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/ingredients', ingredientRoutes);
app.use('/api/v1/menucategories', menuCategoryRoutes);
app.use('/api/v1/menus', menuRoutes);
app.use('/api/v1/addons', addonRoutes);
app.use('/api/v1/outlets', outletRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/bundles', bundleRoutes);
app.use('/api/v1/attendances', attendanceRoutes);
app.use('/api/v1/sales', saleRoutes);
app.use('/api/v1/outletinventorytransactions', outletInventoryTransactionRoutes);
app.use('/api/v1/outletinventory', outletInventoryRoutes);
app.use('/api/v1/data-init', dataInitRoutes);
app.use('/api/v1/promosettings', promoSettingRoutes);
app.use('/api/v1/dailyoutletsalereports', dailySaleReportRoutes);
app.use('/api/v1/useroutlets', userOutletRoutes);
app.use('/api/v1/servicerequests', serviceRequestRoutes);
app.use('/api/v1/admin-notifications', adminNotificationRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);

// Basic route for testing server status
app.get('/api/v1', (req, res) => {
  res.send('API is running...');
});

const PORT = process.env.PORT || 8001; // 8000 is the main port
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));