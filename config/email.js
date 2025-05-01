// Email configuration
// config/email.js

/**
 * Email service configuration
 * Contains settings and credentials for email services
 */

require("dotenv").config();

const config = {
  // Default email sender configuration
  sender: {
    name: process.env.EMAIL_SENDER_NAME || "ATS System",
    email: process.env.EMAIL_SENDER_ADDRESS || "ats@example.com",
  },

  // Provider configurations
  providers: {
    // Gmail IMAP configuration
    gmail: {
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      // When using Gmail, you need to use an app password
      // See: https://support.google.com/accounts/answer/185833
      appPasswordRequired: true,
    },

    // Outlook IMAP configuration
    outlook: {
      host: "outlook.office365.com",
      port: 993,
      secure: true,
    },

    // Generic IMAP configuration (for custom servers)
    imap: {
      // These will be provided by the user
      defaultPort: 993,
      secure: true,
    },
  },

  // Email parsing settings
  parser: {
    // Max attachment size for processing
    maxAttachmentSize: 10 * 1024 * 1024, // 10MB

    // Supported resume file types
    supportedResumeTypes: [".pdf", ".doc", ".docx", ".txt", ".rtf", ".odt"],

    // Job-related keywords for filtering
    jobKeywords: [
      "job",
      "position",
      "candidate",
      "resume",
      "cv",
      "application",
      "apply",
      "applicant",
      "hire",
      "hiring",
      "recruitment",
    ],
  },

  // Rate limiting to prevent abuse
  rateLimits: {
    // Max emails to fetch at once
    maxFetch: 50,

    // Max emails to process at once
    maxProcess: 10,

    // Max requests per minute
    requestsPerMinute: 60,
  },

  // Security settings
  security: {
    // Encryption key for storing sensitive data (if needed)
    encryptionKey: process.env.EMAIL_ENCRYPTION_KEY || "",

    // Whether to validate SSL certificates
    validateCertificates: process.env.NODE_ENV === "production",
  },
};

module.exports = config;
