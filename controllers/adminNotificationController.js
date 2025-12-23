import * as service from '../services/adminNotificationService.js';

export const index = async (req, res) => {
    const result = await service.getAdminNotifications(req.query);
    if (!result.success) return res.status(500).json(result);
    return res.json(result);
};

export const store = async (req, res) => {
    // Biasanya ini dipanggil internal system, tapi kita buka endpoint untuk testing manual
    const result = await service.createAdminNotification(req.body);
    if (!result.success) return res.status(500).json(result);
    return res.status(201).json(result);
};

export const markAsOpened = async (req, res) => {
    const { id } = req.params;
    const result = await service.openAdminNotification(id);
    if (!result.success) return res.status(404).json(result);
    return res.json(result);
};

export const destroy = async (req, res) => {
    const { id } = req.params;
    const result = await service.deleteAdminNotification(id);
    if (!result.success) return res.status(404).json(result);
    return res.json(result);
};