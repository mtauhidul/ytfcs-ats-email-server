// Team notification endpoints
// routes/notifications.js
const express = require("express");
const router = express.Router();
const {
  sendAssignmentNotification,
  sendTeamMemberInvitation,
  sendTeamMemberUpdate,
} = require("../services/emailService");
const { getCandidate, getTeamMember } = require("../services/firebaseService");
const { validateApiKey } = require("../middleware/auth");
const logger = require("../utils/logger");

// Apply auth middleware to all routes
router.use(validateApiKey);

// Assignment notification
router.post("/assignment", async (req, res, next) => {
  try {
    const {
      candidateId,
      teamMemberId,
      candidateName,
      assignerName,
      teamMemberEmail,
    } = req.body;

    if (!candidateId || !teamMemberId || !teamMemberEmail) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // If emails aren't provided, try to get them from the database
    let recipientEmail = teamMemberEmail;
    if (!recipientEmail) {
      const teamMember = await getTeamMember(teamMemberId);
      recipientEmail = teamMember.email;
    }

    if (!recipientEmail) {
      return res.status(400).json({
        success: false,
        message: "Team member email not provided and not found in database",
      });
    }

    // Send the notification
    const result = await sendAssignmentNotification({
      candidateId,
      teamMemberId,
      candidateName,
      assignerName,
      teamMemberEmail: recipientEmail,
    });

    res.status(200).json(result);
  } catch (error) {
    logger.error("Assignment notification error:", error);
    next(error);
  }
});

// Team member notification (invitation or update)
router.post("/team-member", async (req, res, next) => {
  try {
    const {
      type,
      teamMemberId,
      name,
      email,
      role,
      inviterName,
      updaterName,
      previousRole,
    } = req.body;

    if (!type || !teamMemberId || !name || !email || !role) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    let result;

    if (type === "invitation") {
      if (!inviterName) {
        return res.status(400).json({
          success: false,
          message: "Inviter name is required for invitation emails",
        });
      }

      result = await sendTeamMemberInvitation({
        teamMemberId,
        name,
        email,
        role,
        inviterName,
      });
    } else if (type === "update") {
      if (!updaterName || !previousRole) {
        return res.status(400).json({
          success: false,
          message:
            "Updater name and previous role are required for update emails",
        });
      }

      result = await sendTeamMemberUpdate({
        teamMemberId,
        name,
        email,
        role,
        previousRole,
        updaterName,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification type. Must be "invitation" or "update".',
      });
    }

    res.status(200).json(result);
  } catch (error) {
    logger.error("Team member notification error:", error);
    next(error);
  }
});

module.exports = router;
