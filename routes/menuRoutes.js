import express from 'express';
import {
    createMenu,
    getMenus,
    getMenuById,
    updateMenu,
    deleteMenu
} from '../controllers/menuController.js';
import protect from '../middleware/auth.js';
import authorizeRoles from '../middleware/rbac.js';
import { Roles } from '../constants/roles.js';

const router = express.Router();

router.route('/')
    .get(getMenus)
    .post(protect, authorizeRoles(Roles.admin), createMenu);

router.route('/:id')
    .get(getMenuById)
    .put(protect, authorizeRoles(Roles.admin), updateMenu)
    .delete(protect, authorizeRoles(Roles.admin), deleteMenu);


export default router;