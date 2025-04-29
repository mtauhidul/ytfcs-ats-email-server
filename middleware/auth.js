// API authentication
// middleware/auth.js
const logger = require("../utils/logger");

// Validate API key middleware
const validateApiKey = (req, res, next) => {
  // Get API key from header or query parameter
  const apiKey = req.headers["x-api-key"] || req.query.apiKey;

  // Check if API key is provided and matches the expected value
  if (!apiKey || apiKey !== process.env.API_KEY) {
    logger.warn(`Invalid API key attempt: ${req.ip}`);
    return res.status(401).json({
      success: false,
      message: "Unauthorized. Invalid API key.",
    });
  }

  next();
};

module.exports = {
  validateApiKey,
};
