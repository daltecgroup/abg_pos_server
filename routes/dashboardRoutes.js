import express from 'express';
import { getDashboard } from '../controllers/dashboardController.js';
import protect from '../middleware/auth.js';
import authorizeRoles from '../middleware/rbac.js';
import { Roles } from '../constants/roles.js';

const router = express.Router();

router.route('/')
    .get(
        protect, 
        authorizeRoles(Roles.admin, Roles.franchisee, Roles.spvarea), // Batasi akses
        getDashboard
    );

export default router;