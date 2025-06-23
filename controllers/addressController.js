import path from 'path'; // Use import syntax for path
import { fileURLToPath } from 'url'; // Import fileURLToPath from 'url' module

// Get the equivalent of __dirname in ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the base data directory
const DATA_BASE_PATH = path.join(__dirname, '../data/address');

// Helper function to load a specific JSON file
async function loadFile(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return null; // File not found
        }
        throw error; // Re-throw other errors
    }
}

// Ensure fs.promises is imported for async operations
import * as fs from 'fs/promises'; // Import fs.promises for async file operations


// Get all provinces (this file can still be loaded once, as it's the starting point)
export const getProvinces = async (req, res) => { // Use named export
    try {
        const filePath = path.join(DATA_BASE_PATH, 'province.json');
        const data = await loadFile(filePath);
        if (data) {
            res.status(200).json(data);
        } else {
            res.status(404).json({ message: 'Provinces data not found.' });
        }
    } catch (error) {
        console.error('Error fetching provinces:', error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// Generic function to load data based on parent ID and type (for regencies, districts, villages)
async function loadDataByParentId(type, parentId) {
    const filePath = path.join(DATA_BASE_PATH, type, `${parentId}.json`);
    return await loadFile(filePath);
}

// Get regencies by province ID
export const getRegencies = async (req, res) => { // Use named export
    const provinceId = req.params.provinceId;
    try {
        const regencies = await loadDataByParentId('regency', provinceId);
        if (regencies) {
            res.status(200).json(regencies);
        } else {
            res.status(404).json({ message: `Regencies not found for province ID: ${provinceId}.` });
        }
    } catch (error) {
        console.error(`Error fetching regencies for province ${provinceId}:`, error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// Get districts by regency ID
export const getDistricts = async (req, res) => { // Use named export
    const regencyId = req.params.regencyId;
    try {
        const districts = await loadDataByParentId('district', regencyId);
        if (districts) {
            res.status(200).json(districts);
        } else {
            res.status(404).json({ message: `Districts not found for regency ID: ${regencyId}.` });
        }
    } catch (error) {
        console.error(`Error fetching districts for regency ${regencyId}:`, error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// Get villages by district ID
export const getVillages = async (req, res) => { // Use named export
    const districtId = req.params.districtId;
    try {
        const villages = await loadDataByParentId('village', districtId);
        if (villages) {
            res.status(200).json(villages);
        } else {
            res.status(404).json({ message: `Villages not found for district ID: ${districtId}.` });
        }
    } catch (error) {
        console.error(`Error fetching villages for district ${districtId}:`, error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};


// New function to get a single address item by its ID
export const getSingleAddressById = async (req, res) => { // Use named export
    const requestedId = req.params.id;
    let data = null;

    try {
        const idLength = requestedId.length;

        if (idLength === 2) { // Province ID (e.g., "11")
            const filePath = path.join(DATA_BASE_PATH, 'province.json');
            const provinces = await loadFile(filePath);
            if (provinces) {
                data = provinces.find(p => p.id === requestedId);
            }
        } else if (idLength === 4) { // Regency ID (e.g., "1101")
            const provinceId = requestedId.substring(0, 2);
            const regencies = await loadDataByParentId('regency', provinceId);
            if (regencies) {
                data = regencies.find(r => r.id === requestedId);
            }
        } else if (idLength === 6) { // District ID (e.g., "110101")
            const regencyId = requestedId.substring(0, 4);
            const districts = await loadDataByParentId('district', regencyId);
            if (districts) {
                data = districts.find(d => d.id === requestedId);
            }
        } else if (idLength === 10) { // Village ID (e.g., "1101010001")
            const districtId = requestedId.substring(0, 6);
            const villages = await loadDataByParentId('village', districtId);
            if (villages) {
                data = villages.find(v => v.id === requestedId);
            }
        } else {
            return res.status(400).json({ message: 'Invalid address ID length.' });
        }

        if (data) {
            res.status(200).json(data);
        } else {
            res.status(404).json({ message: `Address data with ID ${requestedId} not found.` });
        }

    } catch (error) {
        console.error(`Error fetching single address by ID ${requestedId}:`, error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};