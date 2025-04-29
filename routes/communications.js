// Candidate communication endpoints
// routes/communications.js
const express = require("express");
const router = express.Router();
const { sendCandidateEmail } = require("../services/emailService");
const { updateMessageStatus } = require("../services/firebaseService");
const { validateApiKey } = require("../middleware/auth");
const logger = require("../utils/logger");

// Apply auth middleware to all routes
router.use(validateApiKey);

// Send email to candidate
router.post("/send", async (req, res, next) => {
  try {
    const {
      messageId,
      candidateId,
      candidateName,
      candidateEmail,
      subject,
      body,
      type,
      senderName,
    } = req.body;

    if (!messageId || !candidateId || !candidateEmail || !subject || !body) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Update message status to sending
    await updateMessageStatus(messageId, "sending");

    // Send the email
    const result = await sendCandidateEmail({
      messageId,
      candidateId,
      candidateName: candidateName || "Candidate",
      candidateEmail,
      subject,
      body,
      senderName: senderName || "Hiring Team",
    });

    // Update message status to sent
    await updateMessageStatus(messageId, "sent");

    res.status(200).json(result);
  } catch (error) {
    logger.error("Candidate communication error:", error);

    // Update message status to failed if possible
    if (req.body?.messageId) {
      try {
        await updateMessageStatus(req.body.messageId, "failed");
      } catch (updateError) {
        logger.error("Error updating message status to failed:", updateError);
      }
    }

    next(error);
  }
});

module.exports = router;
