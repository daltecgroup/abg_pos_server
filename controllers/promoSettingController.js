import PromoSetting, { PromoCodes } from '../models/PromoSetting.js';
import mongoose from 'mongoose'; // For ObjectId validation (though we use string _id here)

// @desc    Get all promo settings
// @route   GET /api/v1/promosettings
// @access  Public (or Private/Admin as per your auth setup)
export const getPromoSettings = async (req, res) => {
  try {
    const settings = await PromoSetting.find({}); // Fetch all settings
    res.status(200).json(settings.map(setting => setting.toJSON()));
  } catch (error) {
    console.error('Error fetching promo settings:', error);
    res.status(500).json({ message: 'Server error fetching promo settings.', error: error.message });
  }
};

// @desc    Get a single promo setting by code
// @route   GET /api/v1/promosettings/:code
// @access  Public (or Private/Admin as per your auth setup)
export const getPromoSettingByCode = async (req, res) => {
  try {
    const { code } = req.params;

    if (!Object.values(PromoCodes).includes(code)) {
        return res.status(400).json({ message: 'Kode promo tidak valid.' });
    }

    const setting = await PromoSetting.findById(code);

    if (!setting) {
      return res.status(404).json({ message: 'Pengaturan promo tidak ditemukan.' });
    }
    res.status(200).json(setting.toJSON());
  } catch (error) {
    console.error('Error fetching promo setting by code:', error);
    res.status(500).json({ message: 'Server error fetching promo setting.', error: error.message });
  }
};

// @desc    Update a promo setting by code
// @route   PATCH /api/v1/promosettings/:code
// @access  Private (Admin role)
export const updatePromoSetting = async (req, res) => {
  try {
    const { code } = req.params;
    const updateData = req.body;
    const errors = [];

    // Validate the promo code
    if (!Object.values(PromoCodes).includes(code)) {
        return res.status(400).json({ message: 'Kode promo tidak valid.' });
    }

    // Validate incoming data
    if (updateData.nominal !== undefined && (typeof updateData.nominal !== 'number' || updateData.nominal < 0)) {
      errors.push('Nominal harus berupa angka non-negatif.');
    }
    if (updateData.bonusMaxPrice !== undefined && (typeof updateData.bonusMaxPrice !== 'number' || updateData.bonusMaxPrice < 0)) {
      errors.push('Bonus Max Price harus berupa angka non-negatif.');
    }
    if (updateData.title !== undefined && (typeof updateData.title !== 'string' || updateData.title.trim() === '')) {
      errors.push('Judul harus berupa string non-kosong jika disediakan.');
    } else if (updateData.title !== undefined) {
      updateData.title = updateData.title.trim();
    }
    if (updateData.description !== undefined && typeof updateData.description !== 'string') {
      errors.push('Deskripsi harus berupa string jika disediakan.');
    } else if (updateData.description !== undefined) {
      updateData.description = updateData.description.trim();
    }
    if (updateData.isActive !== undefined && typeof updateData.isActive !== 'boolean') {
      errors.push('isActive harus berupa boolean jika disediakan.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }

    const setting = await PromoSetting.findByIdAndUpdate(
      code, // Use code as the _id to find the document
      { $set: updateData }, // Use $set to update only provided fields
      { new: true, runValidators: true } // Return the updated document, run schema validators
    );

    if (!setting) {
      return res.status(404).json({ message: 'Pengaturan promo tidak ditemukan.' });
    }

    res.status(200).json({
      message: 'Pengaturan promo berhasil diperbarui.',
      promoSetting: setting.toJSON()
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => error.errors[key].message);
      return res.status(400).json({ message: 'Validasi gagal.', errors });
    }
    console.error('Error updating promo setting:', error);
    res.status(500).json({ message: 'Kesalahan server saat memperbarui pengaturan promo.', error: error.message });
  }
};
