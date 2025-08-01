import UserOutlet from '../models/UserOutlet.js';
import User from '../models/User.js';
import Outlet from '../models/Outlet.js';
import mongoose from 'mongoose';
import { Roles } from '../constants/roles.js';

/**
 * @fileoverview Controller functions for managing the UserOutlet model.
 * This includes setting a user's current outlet and retrieving it.
 */

// @desc    Set or update the current outlet for the authenticated user
// @route   POST /api/useroutlets
// @access  Private
export const setCurrentOutlet = async (req, res) => {
  try {
    const { outletId } = req.body;
    const userId = req.user._id; // Get user ID from the authenticated request

    // 1. Validate userId from auth token
    if (!userId) {
      return res.status(401).json({ message: 'Tidak diizinkan. Token tidak valid.' });
    }

    // 2. Validate outletId from request body
    if (!outletId || !mongoose.Types.ObjectId.isValid(outletId)) {
      return res.status(400).json({ message: 'ID Outlet tidak valid.' });
    }

    // 3. Optional: Verify that the user exists and is an operator
    const user = await User.findById(userId);
    if (!user || user.isDeleted || !user.isActive ) {
        return res.status(403).json({ message: 'Pengguna tidak memiliki izin untuk melakukan tindakan ini.' });
    }
    
    // 4. Optional: Verify that the outlet exists and is active
    const outlet = await Outlet.findById(outletId);
    if (!outlet || outlet.isDeleted || !outlet.isActive) {
        return res.status(404).json({ message: 'Outlet tidak ditemukan atau tidak aktif.' });
    }

    // 5. Create or update the UserOutlet document using the user's ID as the _id
    const userOutlet = await UserOutlet.findByIdAndUpdate(
      userId,
      { currentOutlet: outletId },
      { new: true, upsert: true } // 'upsert: true' creates the document if it doesn't exist
    );

    res.status(200).json({
      message: 'Outlet saat ini berhasil diatur.',
      userOutlet: userOutlet.toJSON()
    });

  } catch (error) {
    console.error('Kesalahan saat mengatur outlet pengguna:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengatur outlet pengguna.', error: error.message });
  }
};

// @desc    Get the current outlet for the authenticated user
// @route   GET /api/useroutlets
// @access  Private
export const getCurrentOutlet = async (req, res) => {
  try {
    const userId = req.user._id; // Get user ID from the authenticated request

    // 1. Validate userId from auth token
    if (!userId) {
      return res.status(401).json({ message: 'Tidak diizinkan. Token tidak valid.' });
    }

    // 2. Find the UserOutlet document for the user
    // We use .populate('currentOutlet') to automatically fetch the full outlet document
    const userOutlet = await UserOutlet.findById(userId).populate('currentOutlet');

    if (!userOutlet) {
      // If no record is found, the user has not set a current outlet yet
      return res.status(404).json({ message: 'Tidak ada outlet yang saat ini diatur untuk pengguna ini.' });
    }

    res.status(200).json({
      message: 'Outlet saat ini berhasil diambil.',
      userOutlet: userOutlet.toJSON()
    });

  } catch (error) {
    console.error('Kesalahan saat mengambil outlet pengguna:', error);
    res.status(500).json({ message: 'Kesalahan server saat mengambil outlet pengguna.', error: error.message });
  }
};
