import * as serviceRequestService from '../services/serviceRequestService.js';

// @desc    Create a new service request (Operator)
// @route   POST /api/v1/servicerequests
export const createRequest = async (req, res) => {
    try {
        const userContext = { userId: req.user._id, userName: req.user.name };
        const result = await serviceRequestService.createServiceRequest(req.body, userContext);

        if (!result.success) {
            return res.status(400).json({ 
                message: result.message || 'Validasi gagal', 
                errors: result.errors 
            });
        }
        res.status(201).json({
            message: 'Permintaan berhasil dibuat dan menunggu persetujuan Admin.',
            data: result.data
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error saat membuat request.' });
    }
};

// @desc    Process a request (Approve/Reject) (Admin)
// @route   PATCH /api/v1/servicerequests/:id/process
export const processRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const { action, note } = req.body; 

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ message: 'Action harus "approve" atau "reject".' });
        }

        const userContext = { userId: req.user._id, userName: req.user.name };
        const result = await serviceRequestService.processServiceRequest(id, action, note, userContext);

        if (!result.success) {
            return res.status(400).json({ message: result.message });
        }
        res.status(200).json({
            message: `Permintaan berhasil di-${action}.`,
            data: result.data
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error saat memproses request.' });
    }
};

// @desc    Delete (Cancel) a pending service request
// @route   DELETE /api/v1/servicerequests/:id
export const deleteRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const userContext = { userId: req.user._id, userName: req.user.name };

        const result = await serviceRequestService.deleteServiceRequest(id, userContext);

        if (!result.success) {
            return res.status(400).json({ message: result.message });
        }
        res.status(200).json({
            message: result.message,
            data: result.data
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error saat menghapus request.' });
    }
};

// @desc    Get all requests
// @route   GET /api/v1/servicerequests
export const getAllRequests = async (req, res) => {
    try {
        const filters = {
            outletId: req.query.outletId,
            status: req.query.status,
            type: req.query.type
        };
        const requests = await serviceRequestService.getServiceRequests(filters);
        res.status(200).json(requests);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error mengambil data request.' });
    }
};