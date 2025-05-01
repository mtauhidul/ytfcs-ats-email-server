// middleware/errorHandler.js

const logger = require("../utils/logger");

/**
 * Custom error class for API errors with status code
 */
class ApiError extends Error {
  constructor(message, statusCode, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error for request validation failures
 */
class ValidationError extends ApiError {
  constructor(message, details = null) {
    super(message, 400, details);
    this.name = "ValidationError";
  }
}

/**
 * Not found error for resource not found situations
 */
class NotFoundError extends ApiError {
  constructor(message = "Resource not found", details = null) {
    super(message, 404, details);
    this.name = "NotFoundError";
  }
}

/**
 * Authentication error for auth failures
 */
class AuthenticationError extends ApiError {
  constructor(message = "Authentication required", details = null) {
    super(message, 401, details);
    this.name = "AuthenticationError";
  }
}

/**
 * Authorization error for permission failures
 */
class AuthorizationError extends ApiError {
  constructor(
    message = "Not authorized to access this resource",
    details = null
  ) {
    super(message, 403, details);
    this.name = "AuthorizationError";
  }
}

/**
 * Central error handler middleware
 * @param {Error} err - The error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const errorHandler = (err, req, res, next) => {
  // Log the error details
  logger.error("API Error:", {
    message: err.message,
    name: err.name,
    stack: err.stack,
    path: req.path,
    method: req.method,
    query: req.query,
    body: process.env.NODE_ENV === "development" ? req.body : "[REDACTED]",
  });

  // Determine the status code and error details
  const statusCode = err.statusCode || err.status || 500;
  const errorResponse = {
    success: false,
    message: err.message || "An unexpected error occurred",
    code: err.name || "InternalServerError",
  };

  // Include additional details in development mode or if explicitly provided
  if (err.details) {
    errorResponse.details = err.details;
  }

  // Include stack trace in development mode
  if (process.env.NODE_ENV === "development") {
    errorResponse.stack = err.stack;
  }

  // Send formatted error response
  res.status(statusCode).json(errorResponse);
};

/**
 * Middleware to handle not found routes
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(
    `Route not found: ${req.method} ${req.originalUrl}`
  );
  next(error);
};

/**
 * Async handler wrapper to eliminate try/catch blocks
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Wrapped function that handles errors
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  ApiError,
  ValidationError,
  NotFoundError,
  AuthenticationError,
  AuthorizationError,
};
