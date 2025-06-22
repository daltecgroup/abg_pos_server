import express from 'express';
import {
    createOutlet,
    getOutlets,
    getOutletById,
    updateOutlet,
    deleteOutlet,
    getOutletsByFranchisee,
    getOutletsBySpvArea,
    getOutletsByOperator
} from '../controllers/outletController.js';
import protect from '../middleware/auth.js';
import authorizeRoles from '../middleware/rbac.js';
import { Roles } from '../constants/roles.js';

const router = express.Router();

router.route('/')
    .get(getOutlets)
    .post(protect, authorizeRoles(Roles.admin), createOutlet);

router.route('/:id')
    .get(getOutletById)
    .put(protect, authorizeRoles(Roles.admin), updateOutlet)
    .delete(protect, authorizeRoles(Roles.admin), deleteOutlet);

router.get('/operator/:operatorId', getOutletsByOperator);
router.get('/franchisee/:franchiseeId', getOutletsByFranchisee);
router.get('/spvarea/:spvAreaId', getOutletsBySpvArea);

export default router;