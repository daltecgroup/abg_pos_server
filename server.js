import express, { json } from 'express';
import logger from './middleware/logger.js';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import connectDB from './config/db.js';

// import custom modules
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import ingredientRoutes from './routes/ingredientRoutes.js';
import menuCategoryRoutes from './routes/menuCategoryRoutes.js';
import menuRoutes from './routes/menuRoutes.js';
import addonRoutes from './routes/addonRoutes.js';
import outletRoutes from './routes/outletRoutes.js';
import orderRoutes from './routes/orderRoutes.js';

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

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/ingredients', ingredientRoutes);
app.use('/api/v1/menucategories', menuCategoryRoutes);
app.use('/api/v1/menus', menuRoutes);
app.use('/api/v1/addons', addonRoutes);
app.use('/api/v1/outlets', outletRoutes);
app.use('/api/v1/orders', orderRoutes);

// Basic route for testing server status
app.get('/api/v1', (req, res) => {
  res.send('API is running...');
});

const PORT = process.env.PORT || 8001;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));