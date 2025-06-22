import express from 'express';
import {
    createMenuCategory, 
    getMenuCategories, 
    getMenuCategoryById, 
    updateMenuCategory, 
    deleteMenuCategory
} from '../controllers/menuCategoryController.js';
import protect from '../middleware/auth.js';
import authorizeRoles from '../middleware/rbac.js';
import { Roles } from '../constants/roles.js';

const router = express.Router();

router.route('/')
    .get(getMenuCategories)
    .post(protect, authorizeRoles(Roles.admin), createMenuCategory);

router.route('/:id')
    .get(getMenuCategoryById)
    .put(protect, authorizeRoles(Roles.admin), updateMenuCategory)
    .delete(protect, authorizeRoles(Roles.admin), deleteMenuCategory);


export default router;