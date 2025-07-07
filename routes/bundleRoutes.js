import express from 'express';
import * as controller from '../controllers/bundleController.js';
import protect from '../middleware/auth.js';
import authorizeRoles from '../middleware/rbac.js';
import { Roles } from '../constants/roles.js';

const router = express.Router();

router.route('/')
    .get(controller.getBundles)
    .post(protect, authorizeRoles(Roles.admin), controller.createBundle);

router.route('/:id')
    .get(controller.getBundleById)
    .put(protect, authorizeRoles(Roles.admin), controller.updateBundle)
    .delete(protect, authorizeRoles(Roles.admin), controller.deleteBundle);


export default router;