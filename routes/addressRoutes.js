import express from 'express'; // Use import syntax for express
const router = express.Router();
import * as address from '../controllers/addressController.js'; // Import all exports from the controller

// Route to get all provinces
router.get('/provinces', address.getProvinces);

// Route to get regencies by province ID
router.get('/regencies/:provinceId', address.getRegencies);

// Route to get districts by regency ID
router.get('/districts/:regencyId', address.getDistricts);

// Route to get villages by district ID
router.get('/villages/:districtId', address.getVillages);

// NEW: Route to get a single address item by its specific ID
router.get('/:id', address.getSingleAddressById);

export default router; // Use export default for the router