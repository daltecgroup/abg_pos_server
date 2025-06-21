import User from '../models/User.js'
import { Roles } from '../constants/roles.js'
import { ErrorCode } from '../constants/errorCode.js';

// @desc    Get all users
// @route   GET /api/v1/users
// @access  Private/Admin
export const getUsers = async (req, res) => {
    try {
        const users = await User.find({ isDeleted: false }).select('-password');
        res.json(users);
    } catch (error) {
        console.error(`Error fetching users: ${error.message}`);
        res.status(500).json({
            errorCode: ErrorCode.serverError,
            message: 'Server error',
            error: error.message
        });
    }
};

// @desc    Get latest updated user
// @route   GET /api/v1/users/sync
// @access  Private/Admin
export const syncUsers = async (req, res) => {
    const { latest, idList } = req.body; // idList is expected to be an array of user IDs from the client

    try {
        // 1. Validate 'latest' date
        const latestUpdate = new Date(latest);
        if (isNaN(latestUpdate.getTime())) {
            return res.status(400).json({
                errorCode: ErrorCode.invalidInput,
                message: 'Invalid latest timestamp provided.'
            });
        }
        const clientIdSet = new Set(idList.map(id => id.toString()));
        const usersToProcess = await User.find({
            $or: [
                { updatedAt: { $gt: latestUpdate } },
                { deletedAt: { $gt: latestUpdate } }
            ]
        }).select('-password');


        const toAdd = [];
        const toUpdate = [];
        const toDelete = [];

        usersToProcess.forEach(user => {
            const userIdString = user._id.toString();
            if (user.isDeleted) {
                toDelete.push(user.toObject());
            } else if (clientIdSet.has(userIdString)) {
                toUpdate.push(user.toObject());
            } else {
                if (!user.isDeleted) {
                    toAdd.push(user.toObject());
                }
            }
        });

        res.status(200).json({
            toAdd,
            toUpdate,
            toDelete
        });

    } catch (error) {
        console.error(`Error in syncUsers: ${error.message}`);
        res.status(500).json({
            errorCode: ErrorCode.serverError || 500,
            message: 'Server error during user synchronization',
            error: error.message
        });
    }
};

// @desc    Create a new user
// @route   POST api/v1/users
// @access  Private/Admin
export const createUser = async (req, res) => {
    try {
        const { userId, name, roles, password } = req.body;

        // Check if the user already exists
        const existingUser = await User.findOne({ userId });
        if (existingUser) {
            console.log(ErrorCode.userAlreadyExist)
            return res.status(400).json({
                errorCode: ErrorCode.userAlreadyExist,
                message: 'ID pengguna sudah terdaftar'
            });
        }

        // Create a new user
        const newUser = new User({
            userId,
            name,
            roles: roles && Array.isArray(roles) ? roles : [Roles.operator],
            password,
        });

        const invalidRoles = newUser.roles.filter(role => !Object.values(Roles).includes(role));
        if (invalidRoles.length > 0) {
            return res.status(400).json({ message: `Invalid role(s) provided: ${invalidRoles.join(', ')}` });
        }

        // Save the user to the database
        const createdUser = await newUser.save();
        const userResponse = createdUser.toObject();
        delete userResponse.password;

        console.log(`User successfully created: ${createdUser._id}`);

        res.status(201).json({
            message: 'Pengguna berhasil dibuat',
            user: userResponse
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            errorCode: ErrorCode.serverError,
            message: 'Server error', error: error.message
        });
    }
};

// @desc    Get user by ID
// @route   GET /api/users/:id
// @access  Private
export const getUsersById = async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password');

        if (!user) {
            return res.status(404).json({
                errorCode: ErrorCode.userNotFound,
                message: 'User not found'
            });
        }

        res.status(200).json(user);
    } catch (error) {
        console.error(`Error fetching users: ${error.message}`);
        res.status(500).json({
            errorCode: ErrorCode.serverError,
            message: 'Server error', error: error.message
        });
    }
};

// @desc    Update a user by ID
// @route   PUT /api/v1/users/:id
// @access  Private/Admin
export const updateUserById = async (req, res) => {
    try {
        const { userId, name, roles, phone, password, isActive } = req.body;
        const existingUser = await User.findOne({ userId });

        if (existingUser && existingUser._id != req.params.id) {
            return res.status(404).json({ message: 'ID Pengguna sudah terdaftar' });
        }

        // Find the user by ID and update it
        const updatedUser = await User.findOneAndUpdate(
            { _id: req.params.id },
            { userId, name, roles, phone, password, isActive },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json({
            message: 'Data Pengguna berhasil diubah',
            user: updatedUser
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// @desc    Soft delete a user
// @route   DELETE /api/v1/users/:id
// @access  Private/Admin
export const softDeleteUserById = async (req, res) => {
    try {
        // Find the user by ID and soft delete it
        if(req.user._id == req.params.id) {
            return res.status(404).json({ message: 'Tidak dapat menghapus akun sendiri' });
        }
        
        const deletedUser = await User.findOneAndUpdate(
            { _id: req.params.id },
            { isActive: false, isDeleted: true, deletedAt: Date.now(), deletedBy: req.user._id },
            { new: true }
        );

        if (!deletedUser) {
            return res.status(404).json({ message: 'Pengguna tidak ditemukan' });
        }

        res.status(200).json({
            message: 'Data Pengguna berhasil dihapus',
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
