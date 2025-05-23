// routes/email-import.js
const express = require("express");
const router = express.Router();
const { validateApiKey } = require("../middleware/auth");
const logger = require("../utils/logger");
const {
  validateConnection,
  listEmails,
  processEmails,
  downloadEmailAttachment,
  parseEmailAttachment,
} = require("../services/emailService");
const { processAttachment } = require("../utils/resumeProcessor");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

router.use(validateApiKey);

// Set up temporary storage for email attachments
const tempStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadsDir = path.join(__dirname, "../temp");
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    // Create unique filename with original extension
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `email-att-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

// File type validation
const fileFilter = (req, file, cb) => {
  // Accept only PDF, DOC, DOCX and TXT files
  if (
    file.mimetype === "application/pdf" ||
    file.mimetype === "application/msword" ||
    file.mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.mimetype === "text/plain"
  ) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Invalid file type. Only PDF, DOC, DOCX and TXT files are allowed."
      ),
      false
    );
  }
};

const upload = multer({
  storage: tempStorage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max file size
});

// Apply auth middleware to all routes
router.use(validateApiKey);

/**
 * @route POST /api/email/inbox/connect
 * @desc Validate and connect to an email provider
 * @access Private
 */
router.post("/connect", async (req, res, next) => {
  try {
    const { provider, server, port, username, password } = req.body;

    if (!provider || !username || !password) {
      return res.status(400).json({
        success: false,
        error: "Missing required email account details",
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

    // Validate connection
    await validateConnection(connectionConfig);

    res.status(200).json({
      success: true,
      message: "Connection successful",
    });
  } catch (error) {
    logger.error("Email connection error:", error);
    res.status(400).json({
      success: false,
      error: error.message || "Failed to connect to email provider",
    });
  }
});

/**
 * @route POST /api/email/inbox/list
 * @desc List emails from the connected account with filtering
 * @access Private
 */
router.post("/list", async (req, res, next) => {
  try {
    const {
      provider,
      server,
      port,
      username,
      password,
      filters = {},
    } = req.body;

    if (!provider || !username || !password) {
      return res.status(400).json({
        success: false,
        error: "Missing required email account details",
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

    // List emails with the provided filters
    const result = await listEmails(connectionConfig, filters);
    logger.info(`Listed ${result.emails.length} emails`);

    res.status(200).json(result);
  } catch (error) {
    logger.error("Email listing error:", error);
    res.status(400).json({
      success: false,
      error: error.message || "Failed to list emails",
    });
  }
});

/**
 * @route POST /api/email/inbox/process
 * @desc Process and import selected emails
 * @access Private
 */
router.post("/process", async (req, res, next) => {
  try {
    const { provider, server, port, username, password, emailIds } = req.body;

    if (!provider || !username || !password) {
      return res.status(400).json({
        success: false,
        error: "Missing required email account details",
      });
    }

    if (!Array.isArray(emailIds) || emailIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No emails selected for processing",
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

    // Process the selected emails
    const result = await processEmails(connectionConfig, emailIds);
    logger.info(
      `Processed ${result.processed} emails, imported ${result.candidates.length} candidates`
    );

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error("Email processing error:", error);
    res.status(400).json({
      success: false,
      error: error.message || "Failed to process emails",
    });
  }
});

/**
 * @route POST /api/email/download-attachment
 * @desc Download an email attachment
 * @access Private
 */
router.post("/download-attachment", async (req, res, next) => {
  try {
    const {
      provider,
      server,
      port,
      username,
      password,
      emailId,
      attachmentId,
    } = req.body;

    // Enhanced logging for debugging
    logger.info("Download attachment request received:", {
      provider,
      emailId,
      attachmentId,
      hasCredentials: !!(username && password),
    });

    if (!provider || !username || !password) {
      return res.status(400).json({
        success: false,
        error: "Missing required email account details",
      });
    }

    if (!emailId || !attachmentId) {
      return res.status(400).json({
        success: false,
        error: "Missing emailId or attachmentId",
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

    // Download the attachment
    const attachmentData = await downloadEmailAttachment(
      connectionConfig,
      emailId,
      attachmentId
    );

    logger.info("Attachment downloaded successfully:", {
      filename: attachmentData.filename,
      contentType: attachmentData.contentType,
      size: attachmentData.size,
      encoding: attachmentData.encoding,
    });

    res.status(200).json({
      success: true,
      data: attachmentData,
    });
  } catch (error) {
    // Enhanced error logging
    logger.error("Attachment download error:", {
      error: error.message,
      stack: error.stack,
      name: error.name,
      body: req.body,
    });

    res.status(400).json({
      success: false,
      error: error.message || "Failed to download attachment",
    });
  }
});

/**
 * @route POST /api/email/parse-attachment
 * @desc Parse an email attachment for candidate data
 * @access Private
 */
router.post("/parse-attachment", async (req, res, next) => {
  try {
    const {
      provider,
      server,
      port,
      username,
      password,
      emailId,
      attachmentId,
    } = req.body;

    logger.info("Parse attachment request received:", {
      provider,
      emailId,
      attachmentId,
    });

    if (!provider || !username || !password) {
      return res.status(400).json({
        success: false,
        error: "Missing required email account details",
      });
    }

    if (!emailId || !attachmentId) {
      return res.status(400).json({
        success: false,
        error: "Missing emailId or attachmentId",
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

    // Parse the attachment
    const parsedData = await parseEmailAttachment(
      connectionConfig,
      emailId,
      attachmentId
    );

    logger.info("Attachment parsed successfully");

    res.status(200).json({
      success: true,
      data: parsedData,
    });
  } catch (error) {
    logger.error("Attachment parsing error:", {
      error: error.message,
      stack: error.stack,
      name: error.name,
    });

    res.status(400).json({
      success: false,
      error: error.message || "Failed to parse attachment",
    });
  }
});

/**
 * @route POST /api/email/inbox/attachment
 * @desc Process email attachment directly
 * @access Private
 */
router.post(
  "/attachment",
  upload.single("attachment"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No attachment provided",
        });
      }

      // Process the attachment
      const attachmentMeta = {
        name: req.file.originalname,
        contentType: req.file.mimetype,
        size: req.file.size,
        isResume: /\.(pdf|doc|docx|txt)$/i.test(req.file.originalname),
      };

      // Read the file content
      const fileContent = await fs.promises.readFile(req.file.path);

      // Process the attachment to extract candidate data
      const candidateData = await processAttachment(
        attachmentMeta,
        fileContent
      );

      // Clean up the temp file
      await fs.promises.unlink(req.file.path);

      res.status(200).json({
        success: true,
        data: candidateData,
      });
    } catch (error) {
      // Clean up file if it exists
      if (req.file && req.file.path) {
        try {
          await fs.promises.unlink(req.file.path);
        } catch (cleanupErr) {
          logger.warn("Failed to clean up temp file:", cleanupErr);
        }
      }

      logger.error("Attachment processing error:", error);
      res.status(400).json({
        success: false,
        error: error.message || "Failed to process attachment",
      });
    }
  }
);

module.exports = router;
