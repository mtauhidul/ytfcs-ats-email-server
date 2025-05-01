// middleware/auth.js

const logger = require("../utils/logger");

/**
 * Middleware to validate API key for protected routes
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const validateApiKey = (req, res, next) => {
  // Get API key from header or query parameter
  const apiKey = req.headers["x-api-key"] || req.query.apiKey;

  // Check if API key is provided and matches the expected value
  if (!apiKey || apiKey !== process.env.API_KEY) {
    logger.warn(`Invalid API key attempt from ${req.ip}`);
    return res.status(401).json({
      success: false,
      message: "Unauthorized. Invalid API key.",
    });
  }

  // Authentication successful, proceed
  next();
};

/**
 * Middleware to validate user session for protected routes
 * Useful for routes that require user authentication
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const validateSession = (req, res, next) => {
  // Get session token from header, cookie, or request body
  const sessionToken =
    req.headers.authorization?.replace("Bearer ", "") ||
    req.cookies?.sessionToken ||
    req.body?.sessionToken;

  if (!sessionToken) {
    return res.status(401).json({
      success: false,
      message: "Authentication required. Please login.",
    });
  }

  try {
    // In a real implementation, verify the session token
    // This could involve checking it against a database or validating a JWT

    // For now, we'll use a simple check against an environment variable (for demo purposes)
    // In production, use a proper authentication system
    if (
      process.env.NODE_ENV === "development" &&
      sessionToken === process.env.DEV_SESSION_TOKEN
    ) {
      // Add user information to request object for use in route handlers
      req.user = {
        id: "dev-user",
        role: "admin",
      };
      return next();
    }

    // Implement actual session validation here
    // For example, validate JWT token or check session in database

    logger.warn(`Invalid session token attempt from ${req.ip}`);
    return res.status(401).json({
      success: false,
      message: "Invalid or expired session. Please login again.",
    });
  } catch (error) {
    logger.error("Session validation error:", error);
    return res.status(500).json({
      success: false,
      message: "Authentication error",
    });
  }
};

/**
 * Combined authentication middleware that supports both API key and session-based auth
 * Useful for routes that can be accessed via API key or user session
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const authenticate = (req, res, next) => {
  // Check for API key first
  const apiKey = req.headers["x-api-key"] || req.query.apiKey;

  if (apiKey && apiKey === process.env.API_KEY) {
    // API key authentication successful
    return next();
  }

  // If no valid API key, try session authentication
  validateSession(req, res, next);
};

/**
 * Role-based authorization middleware
 * @param {String|Array} roles - Role or array of roles authorized to access the route
 * @returns {Function} Middleware function
 */
const authorize = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const allowedRoles = Array.isArray(roles) ? roles : [roles];

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn(
        `Authorization failure: User ${req.user.id} with role ${req.user.role} attempted to access restricted route`
      );
      return res.status(403).json({
        success: false,
        message: "You do not have permission to access this resource",
      });
    }

    next();
  };
};

module.exports = {
  validateApiKey,
  validateSession,
  authenticate,
  authorize,
};
