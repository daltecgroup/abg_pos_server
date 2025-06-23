import express from 'express';
const router = express.Router();
import * as controller from '../controllers/addressController.js';

router.get('/provinces', controller.getProvinces);
router.get('/regencies/:provinceId', controller.getRegencies);
router.get('/districts/:regencyId', controller.getDistricts);
router.get('/villages/:districtId', controller.getVillages);
router.get('/:id', controller.getSingleAddressById);

export default router;