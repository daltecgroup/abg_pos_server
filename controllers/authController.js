import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { Roles } from '../constants/roles.js';
import { ErrorCode } from '../constants/errorCode.js';

// Helper function to generate a JWT token
const generateToken = (id, roles) => {
    return jwt.sign({ id, roles }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN,
    });
};

// @desc    Register a new admin
// @route   POST /api/v1/auth/register-admin
// @access  Public
export const registerAdmin = async (req, res) => {
    try {
        const { userId, name, password } = req.body;

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
            roles: Roles.admin,
            password,
        });

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

// @desc    Authenticate user & get token
// @route   POST /api/v1/auth/login
// @access  Public
export const authUser = async (req, res) => {
    const { userId, password } = req.body;
    console.log(`User logging in: ${userId}`);
    
    try {
        const user = await User.findOne({ userId });
        
        // check if user is deleted
        if((user && user.isDeleted) || !user){
            return res.status(410).json({ message: 'User has been deleted' });
        }

        // check if user is innactive
        if(user && !user.isActive){
            console.log(user.isActive);
            return res.status(404).json({ message: 'User is deactivated' });
        }

        // Check if user exists and password matches
        if (user && (await user.matchPassword(password))) {
            const userObject = user.toObject();
            delete userObject.password;
            res.json({
                data: userObject,
                token: generateToken(user._id, user.roles),
            });
        } else {
            res.status(401).json({ message: 'Invalid User ID or password' });
        }
    } catch (error) {
        console.error(`Login error for email ${req.body.email}:`, error);
        res.status(500).json({ message: 'Server error during login process' });
    }
};

// @desc    Get user profile (example of a protected route)
// @route   GET /api/v1/auth/profile
// @access  Private
export const getUserProfile = async (req, res) => {
    res.status(200).json({
        _id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        roles: req.user.roles,
    })
};