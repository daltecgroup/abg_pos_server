import express from 'express';
import {
    createBundle,
    getBundles,
    getBundleById,
    updateBundle,
    deleteBundle
} from '../controllers/bundleController.js';
import protect from '../middleware/auth.js';
import authorizeRoles from '../middleware/rbac.js';
import { Roles } from '../constants/roles.js';

const router = express.Router();

router.route('/')
    .get(getBundles)
    .post(protect, authorizeRoles(Roles.admin), createBundle);

router.route('/:id')
    .get(getBundleById)
    .put(protect, authorizeRoles(Roles.admin), updateBundle)
    .delete(protect, authorizeRoles(Roles.admin), deleteBundle);


export default router;