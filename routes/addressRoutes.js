import express from 'express';
const router = express.Router();
import * as address from '../controllers/addressController.js';

router.get('/provinces', address.getProvinces);
router.get('/regencies/:provinceId', address.getRegencies);
router.get('/districts/:regencyId', address.getDistricts);
router.get('/villages/:districtId', address.getVillages);
router.get('/:id', address.getSingleAddressById);

export default router;