import User from '../models/User.js'
import { Roles } from '../constants/roles.js'
import { ErrorCode } from '../constants/errorCode.js';

// @desc    Get all users
// @route   GET /api/v1/users
// @access  Private/Admin
export const getUsers = async (req, res) => {
    try {
        const users = await User.find({}).select('-password');
        res.json(users);
    } catch (error) {
        console.error(`Error fetching users: ${error.message}`);
        res.status(500).json({
            errorCode: ErrorCode.serverError,
            message: 'Server error', error: error.message
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
            message: 'User created successfully',
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

        if(!user) {
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
        const { userId, name, roles, phone, password, isActive} = req.body;
        const updatedAt = new Date();

        const existingUser = await User.findOne({userId});

        if(existingUser && existingUser._id != req.params.id){
            return res.status(404).json({ message: 'ID Pengguna sudah terdaftar' });
        }
        
        // Find the user by ID and update it
        const updatedUser = await User.findOneAndUpdate(
            {_id: req.params.id},
            { userId, name, roles, phone, updatedAt, password, isActive },
            { new: true }
        );
        
        if (!updatedUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json(updatedUser);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};