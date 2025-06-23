import express from 'express';
import {
    createOrder,
    getOrders,
    getOrderById,
    updateOrder,
    deleteOrder,
} from '../controllers/orderController.js';
import protect from '../middleware/auth.js';
import authorizeRoles from '../middleware/rbac.js';
import { Roles } from '../constants/roles.js';

const router = express.Router();

router.route('/')
    .get(getOrders)
    .post(protect, authorizeRoles(Roles.admin, Roles.franchisee, Roles.operator), createOrder);

router.route('/:id')
    .get(getOrderById)
    .put(protect, authorizeRoles(Roles.admin), updateOrder)
    .delete(protect, authorizeRoles(Roles.admin), deleteOrder);


export default router;