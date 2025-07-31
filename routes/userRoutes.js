import express from 'express';
import * as controller from '../controllers/userController.js';
import protect from '../middleware/auth.js'; // Authentication middleware
import authorizeRoles from '../middleware/rbac.js';
import { Roles } from '../constants/roles.js';

const router = express.Router();

router.route('/')
  .get(protect, authorizeRoles(Roles.admin), controller.getUsers)
  .post(protect, authorizeRoles(Roles.admin), controller.createUser);

router.route('/sync')
  .post(protect, controller.syncUsers);

router.route('/:id')
  .get(protect, controller.getUserById)
  .put(protect, authorizeRoles(Roles.admin), controller.updateUserById)
  .delete(protect, authorizeRoles(Roles.admin), controller.softDeleteUserById);


export default router;