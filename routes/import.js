// Email import functionality
// routes/import.js
const express = require("express");
const router = express.Router();
const { listEmails, processEmails } = require("../services/importService");
const { validateApiKey } = require("../middleware/auth");
const logger = require("../utils/logger");

// Apply auth middleware to all routes
router.use(validateApiKey);

// Import candidates from email
router.post("/candidates", async (req, res, next) => {
  try {
    const {
      provider,
      server,
      port,
      username,
      password,
      action,
      emailIds,
      filters,
    } = req.body;

    if (!provider || !username || !password) {
      return res.status(400).json({
        success: false,
        message: "Missing required email account details",
      });
    }

    // Setup connection config
    const connectionConfig = {
      provider,
      server,
      port,
      username,
      password,
    };

    let result;

    // List emails or process selected emails
    if (
      action === "processEmails" &&
      Array.isArray(emailIds) &&
      emailIds.length > 0
    ) {
      result = await processEmails(connectionConfig, emailIds);
      logger.info(`Processed ${result.processed} emails`);
    } else {
      // Default is to list emails
      result = await listEmails(connectionConfig, filters);
      logger.info(`Listed ${result.emails.length} emails`);
    }

    res.status(200).json(result);
  } catch (error) {
    logger.error("Email import error:", error);
    next(error);
  }
});

module.exports = router;
