import express from 'express';
import { createRequest, processRequest, getAllRequests, deleteRequest } from '../controllers/serviceRequestController.js';
import protect from '../middleware/auth.js';
import authorizeRoles from '../middleware/rbac.js';
import { Roles } from '../constants/roles.js';

const router = express.Router();

router.route('/')
    .post(protect, authorizeRoles(Roles.operator, Roles.spvarea, Roles.franchisee), createRequest)
    .get(protect, authorizeRoles(Roles.admin, Roles.spvarea, Roles.franchisee), getAllRequests);

router.route('/:id')
    .delete(protect, authorizeRoles(Roles.operator, Roles.admin, Roles.spvarea), deleteRequest);

router.route('/:id/process')
    .patch(protect, authorizeRoles(Roles.admin, Roles.spvarea), processRequest);

export default router;