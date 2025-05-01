// services/emailService.js

const Imap = require("imap");
const { simpleParser } = require("mailparser");
const { addCandidateFromEmail } = require("./firebaseService");
const logger = require("../utils/logger");
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const { processAttachment } = require("../utils/resumeProcessor");

/**
 * Setup connection to IMAP server
 * @param {Object} connectionConfig - Email provider configuration
 * @returns {Imap} The configured IMAP connection
 */
const setupImapConnection = ({
  provider,
  server,
  port,
  username,
  password,
}) => {
  // Default server configurations for common providers
  const serverConfigs = {
    gmail: { host: "imap.gmail.com", port: 993 },
    outlook: { host: "outlook.office365.com", port: 993 },
    other: { host: server, port: port ? parseInt(port, 10) : 993 },
  };

  const config = serverConfigs[provider];

  return new Imap({
    user: username,
    password: password,
    host: config.host,
    port: config.port,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
  });
};

/**
 * Parse email to extract candidate information
 * @param {Object} email - Parsed email object from mailparser
 * @returns {Object} Candidate data extracted from the email
 */
const parseCandidateFromEmail = (email) => {
  // Extract candidate data from email
  const candidateData = {
    name: email.from?.value[0]?.name || "Unknown Candidate",
    email: email.from?.value[0]?.address,
    source: "email_import",
    importDate: new Date().toISOString(),
    notes: `Imported from email with subject: ${email.subject}`,
    // Set as unassigned initially
    stageId: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [
      {
        date: new Date().toISOString(),
        note: `Imported from email with subject: "${email.subject}"`,
      },
    ],
  };

  // Process attachments if any
  if (email.attachments && email.attachments.length > 0) {
    candidateData.hasResume = true;
    candidateData.resumeFileName = email.attachments[0].filename;

    // Check if we have a resume attachment to try to extract more data
    const resumeAttachments = email.attachments.filter((attachment) => {
      const filename = attachment.filename.toLowerCase();
      return (
        filename.endsWith(".pdf") ||
        filename.endsWith(".doc") ||
        filename.endsWith(".docx") ||
        filename.endsWith(".txt")
      );
    });

    if (resumeAttachments.length > 0) {
      candidateData.hasResumeAttachment = true;
    }
  }

  return candidateData;
};

/**
 * Checks if an email is job-related based on its subject
 * @param {string} subject - Email subject
 * @returns {boolean} Whether the email appears to be job-related
 */
const isJobRelatedEmail = (subject) => {
  if (!subject) return false;

  const lowerSubject = subject.toLowerCase();

  // Check for job codes like "job [ABC123]" or similar patterns
  const hasJobCode = /job\s*\[\w+\]/i.test(lowerSubject);

  // Check for keywords in subject
  const hasJobKeyword =
    lowerSubject.includes("job") ||
    lowerSubject.includes("candidate") ||
    lowerSubject.includes("resume") ||
    lowerSubject.includes("cv");

  return hasJobCode || hasJobKeyword;
};

/**
 * Create a temp directory for attachment processing
 * @returns {Promise<string>} Path to temp directory
 */
const createTempDir = async () => {
  const tempDir = path.join(__dirname, "../temp", `email-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
};

/**
 * List emails from IMAP inbox
 * @param {Object} connectionConfig - Email provider configuration
 * @param {Object} filters - Filter criteria for emails
 * @returns {Promise<Object>} Object containing fetched emails
 */
const listEmails = async (connectionConfig, filters = {}) => {
  return new Promise((resolve, reject) => {
    const imap = setupImapConnection(connectionConfig);
    const emails = [];

    imap.once("ready", () => {
      imap.openBox("INBOX", false, (err, box) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        // Build search criteria
        let searchCriteria = ["ALL"];

        // For date filtering
        if (filters.dateFilter === "today") {
          const today = new Date();
          searchCriteria = [["SINCE", today.toISOString().split("T")[0]]]; // Note the extra brackets!
        } else if (filters.dateFilter === "week") {
          const lastWeek = new Date();
          lastWeek.setDate(lastWeek.getDate() - 7);
          searchCriteria = [["SINCE", lastWeek.toISOString().split("T")[0]]]; // Note the extra brackets!
        } else if (filters.dateFilter === "month") {
          const lastMonth = new Date();
          lastMonth.setMonth(lastMonth.getMonth() - 1);
          searchCriteria = [["SINCE", lastMonth.toISOString().split("T")[0]]]; // Note the extra brackets!
        }

        imap.search(searchCriteria, (err, results) => {
          if (err) {
            imap.end();
            return reject(err);
          }

          if (!results || !results.length) {
            imap.end();
            return resolve({ emails: [] });
          }

          // Create a fetch for retrieving email headers and structure for attachments
          const fetch = imap.fetch(results, {
            bodies: ["HEADER.FIELDS (FROM TO SUBJECT DATE)"],
            struct: true,
          });

          fetch.on("message", (msg, seqno) => {
            const email = { id: seqno.toString(), hasAttachments: false };

            msg.on("body", (stream, info) => {
              let buffer = "";
              stream.on("data", (chunk) => {
                buffer += chunk.toString("utf8");
              });

              stream.on("end", () => {
                const header = Imap.parseHeader(buffer);

                if (!header.from || !header.from.length) {
                  return; // Skip invalid emails
                }

                const fromHeader = header.from[0];
                let fromName = fromHeader;
                let fromEmail = fromHeader;

                // Extract name and email from "Name <email>" format
                const emailMatch = fromHeader.match(/<(.+)>/);
                if (emailMatch) {
                  fromEmail = emailMatch[1];
                  fromName = fromHeader.split("<")[0].trim();
                }

                email.from = {
                  name: fromName,
                  email: fromEmail,
                };

                email.subject = header.subject
                  ? header.subject[0]
                  : "(No subject)";
                email.receivedAt = header.date
                  ? header.date[0]
                  : new Date().toISOString();
              });
            });

            msg.once("attributes", (attrs) => {
              // Check if email has attachments
              const attachments = [];
              if (attrs.struct) {
                const traverse = (parts) => {
                  for (const part of parts) {
                    if (Array.isArray(part)) {
                      traverse(part);
                    } else if (
                      part.disposition &&
                      ["attachment", "inline"].includes(
                        part.disposition.type.toLowerCase()
                      )
                    ) {
                      const filename =
                        part.params?.name ||
                        `unknown-${attachments.length + 1}`;
                      // Determine if it's likely a resume
                      const isResume = /\.(pdf|doc|docx|rtf|txt|odt)$/i.test(
                        filename
                      );

                      attachments.push({
                        id: `att-${seqno}-${attachments.length + 1}`,
                        name: filename,
                        contentType:
                          part.type?.toLowerCase() +
                            "/" +
                            part.subtype?.toLowerCase() ||
                          "application/octet-stream",
                        size: part.size || 0,
                        isResume,
                      });
                    }
                  }
                };

                if (attrs.struct.length > 0) {
                  traverse(attrs.struct);
                }
              }

              email.hasAttachments = attachments.length > 0;
              email.attachments = attachments;
            });

            msg.once("end", () => {
              // Only add the email if filters are satisfied
              let addEmail = true;

              // Apply job-related filter if requested
              if (filters.jobRelated && !isJobRelatedEmail(email.subject)) {
                addEmail = false;
              }

              // Apply attachment filter if requested
              if (filters.withAttachments && !email.hasAttachments) {
                addEmail = false;
              }

              if (addEmail) {
                emails.push(email);
              }
            });
          });

          fetch.once("error", (err) => {
            imap.end();
            reject(err);
          });

          fetch.once("end", () => {
            imap.end();
            resolve({ emails });
          });
        });
      });
    });

    imap.once("error", (err) => {
      reject(err);
    });

    imap.once("end", () => {
      logger.info("IMAP connection ended");
    });

    imap.connect();
  });
};

/**
 * Download an attachment from an email
 * @param {Imap} imap - IMAP connection
 * @param {number} msgId - Message ID
 * @param {Object} part - Message part containing the attachment
 * @param {string} tempDir - Directory to save the attachment
 * @returns {Promise<Object>} Attachment info including file path
 */
const downloadAttachment = (imap, msgId, part, tempDir) => {
  return new Promise((resolve, reject) => {
    const filename = part.params.name;
    const filePath = path.join(tempDir, filename);

    const msg = imap.fetch(msgId, { bodies: [part.partID] });

    msg.on("message", (msg) => {
      msg.on("body", async (stream, info) => {
        try {
          // Save attachment to temp file
          const writeStream = fs.createWriteStream(filePath);
          stream.pipe(writeStream);

          writeStream.on("finish", () => {
            resolve({
              name: filename,
              path: filePath,
              contentType: `${part.type}/${part.subtype}`,
              size: part.size,
            });
          });
        } catch (error) {
          reject(error);
        }
      });
    });

    msg.once("error", reject);
  });
};

/**
 * Process selected emails and import candidates
 * @param {Object} connectionConfig - Email provider configuration
 * @param {Array<string>} emailIds - IDs of emails to process
 * @returns {Promise<Object>} Result of the email processing
 */
const processEmails = async (connectionConfig, emailIds) => {
  return new Promise((resolve, reject) => {
    const imap = setupImapConnection(connectionConfig);
    const processedEmails = [];
    const candidates = [];

    imap.once("ready", () => {
      imap.openBox("INBOX", false, async (err, box) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        if (!emailIds || emailIds.length === 0) {
          imap.end();
          return resolve({ processed: 0, candidates: [] });
        }

        // Create a temp directory for attachments
        const tempDir = await createTempDir().catch((err) => {
          logger.error("Error creating temp directory:", err);
          return null;
        });

        if (!tempDir) {
          imap.end();
          return reject(new Error("Failed to create temporary directory"));
        }

        // Convert emailIds to numbers for IMAP
        const numericIds = emailIds.map((id) => parseInt(id, 10));

        // Create a fetch for full email content
        const fetch = imap.fetch(numericIds, { bodies: "", struct: true });

        fetch.on("message", (msg, seqno) => {
          msg.on("body", async (stream, info) => {
            try {
              // Parse the email content
              const email = await simpleParser(stream);
              processedEmails.push(seqno);

              // Extract candidate information
              const candidateData = parseCandidateFromEmail(email);

              // Process resume attachments if present
              if (email.attachments && email.attachments.length > 0) {
                for (const attachment of email.attachments) {
                  const filename = attachment.filename.toLowerCase();

                  // Check if this is a resume file
                  if (
                    filename.endsWith(".pdf") ||
                    filename.endsWith(".doc") ||
                    filename.endsWith(".docx") ||
                    filename.endsWith(".txt")
                  ) {
                    try {
                      // Save attachment to temp file
                      const attPath = path.join(
                        tempDir,
                        `${Date.now()}-${attachment.filename}`
                      );
                      await fs.writeFile(attPath, attachment.content);

                      // Call the resume parser API endpoint
                      const formData = new FormData();
                      formData.append(
                        "file",
                        new Blob([attachment.content]),
                        attachment.filename
                      );

                      // In a real implementation, you would call your resume parsing endpoint
                      // For now, we'll use the built-in resume processor utility
                      const enhancedData = await processAttachment(
                        {
                          name: attachment.filename,
                          contentType: attachment.contentType,
                          size: attachment.size,
                          isResume: true,
                        },
                        attachment.content
                      );

                      // Merge the parsed data with candidate data
                      Object.assign(candidateData, {
                        skills: enhancedData.skills || [],
                        experience: enhancedData.experience || "",
                        education: enhancedData.education || "",
                        resumeText: enhancedData.resumeText || "",
                      });

                      // Clean up temp file
                      await fs.unlink(attPath).catch((err) => {
                        logger.warn(
                          `Failed to remove temp file ${attPath}:`,
                          err
                        );
                      });
                    } catch (attError) {
                      logger.error(
                        `Error processing attachment ${attachment.filename}:`,
                        attError
                      );
                    }
                  }
                }
              }

              // Add to database
              try {
                const result = await addCandidateFromEmail(candidateData);
                candidates.push({ ...candidateData, id: result.id });
              } catch (dbError) {
                logger.error(
                  `Error adding candidate from email ${seqno} to database:`,
                  dbError
                );
              }
            } catch (error) {
              logger.error(`Error processing email ${seqno}:`, error);
            }
          });
        });

        fetch.once("error", (err) => {
          imap.end();
          reject(err);
        });

        fetch.once("end", () => {
          // Clean up temp directory
          fs.rmdir(tempDir, { recursive: true }).catch((err) => {
            logger.warn(`Failed to remove temp directory ${tempDir}:`, err);
          });

          imap.end();
          resolve({
            processed: processedEmails.length,
            candidates,
          });
        });
      });
    });

    imap.once("error", (err) => {
      reject(err);
    });

    imap.connect();
  });
};

/**
 * Validate email connection
 * @param {Object} connectionConfig - Email provider configuration
 * @returns {Promise<Object>} Connection validation result
 */
const validateConnection = async (connectionConfig) => {
  return new Promise((resolve, reject) => {
    const imap = setupImapConnection(connectionConfig);

    imap.once("ready", () => {
      imap.end();
      resolve({ success: true, message: "Connection successful" });
    });

    imap.once("error", (err) => {
      reject(new Error(`Connection failed: ${err.message}`));
    });

    imap.connect();
  });
};

module.exports = {
  listEmails,
  processEmails,
  validateConnection,
  parseCandidateFromEmail,
  isJobRelatedEmail,
};
