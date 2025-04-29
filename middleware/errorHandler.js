// Centralized error handling
// middleware/errorHandler.js
const logger = require("../utils/logger");

// Central error handler
const errorHandler = (err, req, res, next) => {
  // Log the error details
  logger.error("API Error:", {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // Determine status code
  const statusCode = err.statusCode || 500;

  // Send a user-friendly response
  res.status(statusCode).json({
    success: false,
    message: err.message || "An unexpected error occurred",
    error: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
};

module.exports = {
  errorHandler,
};
