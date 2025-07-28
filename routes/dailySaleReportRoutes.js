import express from 'express';
import * as dailySaleReportController from '../controllers/dailySaleReportController.js';
import protect from '../middleware/auth.js';

const router = express.Router();

// --- Daily Sale Report Routes ---
// Base URL for these routes will be /api/v1/dailyoutletsalereports

router.route('/')
  .get(protect, dailySaleReportController.getDailyOutletSaleReports); // Get all reports (with filters)

router.route('/:id')
  .get(protect, dailySaleReportController.getDailyOutletSaleReportById); // Get a single report by ID


export default router;
