import express from 'express';
import {
  createUser,
  getUsers,
  syncUsers,
  getUsersById,
  updateUserById,
  softDeleteUserById
} from '../controllers/userController.js';
import protect from '../middleware/auth.js'; // Authentication middleware
import authorizeRoles from '../middleware/rbac.js';
import { Roles } from '../constants/roles.js';

const router = express.Router();

router.route('/')
  .get(protect, authorizeRoles(Roles.admin), getUsers)
  .post(protect, authorizeRoles(Roles.admin), createUser);

router.route('/:id')
  .get(protect, getUsersById)
  .put(protect, authorizeRoles(Roles.admin), updateUserById)
  .delete(protect, authorizeRoles(Roles.admin), softDeleteUserById);

  router.route('/sync')
  .post(protect, authorizeRoles(Roles.admin), syncUsers);

export default router;