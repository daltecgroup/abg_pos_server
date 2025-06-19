// This middleware factory returns a middleware function.
// It takes a variable number of 'allowedRoles' as arguments (e.g., authorizeRoles('admin', 'editor')).
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    // req.user should be populated by the 'protect' middleware (authentication middleware)
    // It is expected to contain the user object, including its 'roles' property, which is an array of strings.

    // First, check if user information and roles are present and valid
    if (!req.user || !Array.isArray(req.user.roles) || req.user.roles.length === 0) {
      // This scenario indicates that either:
      // 1. The 'protect' middleware didn't run before this, or failed.
      // 2. The user object attached by 'protect' is missing, or its 'roles' property is invalid/empty.
      // In a robust application, this might be a sign that the authentication flow needs review.
      return res.status(403).json({ message: 'Access denied: User roles not found or invalid.' });
    }

    // Now, determine if the authenticated user has any of the 'allowedRoles'.
    // The .some() method checks if at least one element in the user's roles array
    // satisfies the condition (i.e., is included in the allowedRoles list).
    const hasPermission = req.user.roles.some(userRole => allowedRoles.includes(userRole));

    if (hasPermission) {
      // If the user has at least one of the required roles, they are authorized.
      next(); // Proceed to the next middleware or route handler
    } else {
      // If the user does not have any of the required roles, access is denied.
      res.status(403).json({ message: 'Access denied: You do not have the required role(s) to access this resource.' });
    }
  };
};

export default authorizeRoles;