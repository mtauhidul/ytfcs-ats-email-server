// services/emailService.js
const { Resend } = require("resend");
const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

// Initialize Resend with your API key
const resend = new Resend(process.env.RESEND_API_KEY);

// Get email template
const getTemplate = (templateName) => {
  try {
    const templatePath = path.join(
      __dirname,
      "../templates",
      `${templateName}.html`
    );
    return fs.readFileSync(templatePath, "utf8");
  } catch (error) {
    logger.error(`Error loading template ${templateName}:`, error);
    throw new Error(
      `Email template ${templateName} not found or could not be loaded`
    );
  }
};

// Replace template variables
const processTemplate = (template, variables) => {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{{\\s*${key}\\s*}}`, "g"), value || "");
  }
  return result;
};

// Send email using Resend
const sendEmail = async ({
  to,
  subject,
  templateName,
  templateData,
  from = {
    email: process.env.DEFAULT_FROM_EMAIL,
    name: process.env.DEFAULT_FROM_NAME,
  },
  attachments = [],
}) => {
  try {
    // Get and process the template
    const template = getTemplate(templateName);
    const htmlContent = processTemplate(template, templateData);

    // Prepare email data for Resend
    const emailData = {
      from: `${from.name} <${from.email}>`,
      to: Array.isArray(to) ? to : [to],
      subject,
      html: htmlContent,
      // Attachments if any
      attachments: attachments.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
      })),
    };

    // Send the email
    const { data, error } = await resend.emails.send(emailData);

    if (error) {
      throw new Error(`Resend API error: ${error.message}`);
    }

    logger.info(`Email sent successfully to ${to}, Resend ID: ${data.id}`);
    return {
      success: true,
      message: "Email sent successfully",
      id: data.id,
    };
  } catch (error) {
    logger.error("Email sending error:", error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

// Send assignment notification
const sendAssignmentNotification = async ({
  candidateId,
  teamMemberId,
  candidateName,
  assignerName,
  teamMemberEmail,
}) => {
  return sendEmail({
    to: teamMemberEmail,
    subject: `Candidate Assigned: ${candidateName}`,
    templateName: "assignmentNotification",
    templateData: {
      candidateName,
      assignerName,
      candidateId,
      teamMemberId,
      appUrl: process.env.APP_URL || "https://your-ats-app.com",
    },
  });
};

// Send team member invitation
const sendTeamMemberInvitation = async ({
  teamMemberId,
  name,
  email,
  role,
  inviterName,
}) => {
  return sendEmail({
    to: email,
    subject: "You've been invited to join the ATS platform",
    templateName: "teamInvitation",
    templateData: {
      name,
      role,
      inviterName,
      loginUrl: `${process.env.APP_URL || "https://your-ats-app.com"}/auth/login`,
      appUrl: process.env.APP_URL || "https://your-ats-app.com",
    },
  });
};

// Send team member update notification
const sendTeamMemberUpdate = async ({
  teamMemberId,
  name,
  email,
  role,
  previousRole,
  updaterName,
}) => {
  return sendEmail({
    to: email,
    subject: "Your ATS account has been updated",
    templateName: "teamUpdate",
    templateData: {
      name,
      role,
      previousRole,
      updaterName,
      loginUrl: `${process.env.APP_URL || "https://your-ats-app.com"}/auth/login`,
      appUrl: process.env.APP_URL || "https://your-ats-app.com",
    },
  });
};

// Send email to candidate
const sendCandidateEmail = async ({
  messageId,
  candidateId,
  candidateName,
  candidateEmail,
  subject,
  body,
  senderName,
}) => {
  return sendEmail({
    to: candidateEmail,
    subject,
    templateName: "candidateEmail",
    templateData: {
      candidateName,
      messageBody: body,
      senderName,
      messageId,
      appUrl: process.env.APP_URL || "https://your-ats-app.com",
    },
  });
};

module.exports = {
  sendEmail,
  sendAssignmentNotification,
  sendTeamMemberInvitation,
  sendTeamMemberUpdate,
  sendCandidateEmail,
};
