import express from 'express';
import {
    createIngredient,
    getIngredients,
    getIngredientById,
    updateIngredient,
    deleteIngredient,
    getIngredientHistory
} from '../controllers/ingredientController.js';
import protect from '../middleware/auth.js';
import authorizeRoles from '../middleware/rbac.js';
import { Roles } from '../constants/roles.js';

const router = express.Router();

router.route('/')
    .get(getIngredients)
    .post(protect, authorizeRoles(Roles.admin), createIngredient);
    
    router.route('/:id')
    .get(getIngredientById)
    .put(protect, authorizeRoles(Roles.admin), updateIngredient)
    .delete(protect, authorizeRoles(Roles.admin), deleteIngredient);

    router.route('/:id/history')
    .get(getIngredientHistory);


export default router;