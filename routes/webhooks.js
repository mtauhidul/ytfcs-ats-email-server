// Email reply handling
// routes/webhooks.js
const express = require("express");
const router = express.Router();
const { updateMessageStatus } = require("../services/firebaseService");
const logger = require("../utils/logger");

// Receive email replies or delivery events
router.post("/receive", async (req, res, next) => {
  try {
    // Extract provider-specific data
    const eventData = req.body;

    // Example for SendGrid event webhook
    if (eventData.sg_event_id) {
      // This is a SendGrid event
      const { sg_event_id, sg_message_id, event, timestamp, email } = eventData;

      // Extract our message ID from the custom headers or categories
      const messageId = eventData.ats_message_id || "";

      if (messageId) {
        // Update message status based on the event
        if (event === "delivered") {
          await updateMessageStatus(messageId, "sent");
        } else if (event === "open") {
          await updateMessageStatus(messageId, "read");
        } else if (["bounce", "dropped", "deferred"].includes(event)) {
          await updateMessageStatus(messageId, "failed");
        }
      }

      logger.info(`Processed ${event} event for email: ${email}`);
    } else {
      // Handle other providers or email replies
      logger.info("Received webhook data from unknown provider");
    }

    // Always return success to the webhook caller
    res.status(200).json({ success: true });
  } catch (error) {
    logger.error("Webhook processing error:", error);

    // Still return 200 status to prevent retries
    res.status(200).json({
      success: false,
      message: "Error processing webhook",
    });
  }
});

module.exports = router;
