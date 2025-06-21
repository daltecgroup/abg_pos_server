// This middleware factory returns a middleware function.
// It takes a variable number of 'allowedRoles' as arguments (e.g., authorizeRoles('admin', 'editor')).
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !Array.isArray(req.user.roles) || req.user.roles.length === 0) {
      return res.status(403).json({ message: 'Access denied: User roles not found or invalid.' });
    }
    const hasPermission = req.user.roles.some(userRole => allowedRoles.includes(userRole));
    if (hasPermission) {
      next();
    } else {
      res.status(403).json({ message: 'Access denied: You do not have the required role(s) to access this resource.' });
    }
  };
};

export default authorizeRoles;