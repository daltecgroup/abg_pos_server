import express from 'express';
import {
    createAddon,
    getAddons,
    getAddonById,
    updateAddon,
    deleteAddon
} from '../controllers/addonController.js';
import protect from '../middleware/auth.js';
import authorizeRoles from '../middleware/rbac.js';
import { Roles } from '../constants/roles.js';

const router = express.Router();

router.route('/')
    .get(getAddons)
    .post(protect, authorizeRoles(Roles.admin), createAddon);

router.route('/:id')
    .get(getAddonById)
    .put(protect, authorizeRoles(Roles.admin), updateAddon)
    .delete(protect, authorizeRoles(Roles.admin), deleteAddon);


export default router;