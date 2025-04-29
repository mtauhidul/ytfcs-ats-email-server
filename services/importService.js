// Email import logic
const Imap = require("imap");
const { simpleParser } = require("mailparser");
const { addCandidateFromEmail } = require("./firebaseService");
const logger = require("../utils/logger");

// Setup connection to IMAP server
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

// Parse email to get candidate information
const parseCandidateFromEmail = (email) => {
  // Basic implementation - extract info from email
  const candidateData = {
    name: email.from?.value[0]?.name || "Unknown Candidate",
    email: email.from?.value[0]?.address,
    source: "email_import",
    importDate: new Date().toISOString(),
    notes: `Imported from email with subject: ${email.subject}`,
  };

  // Process attachments if any
  if (email.attachments && email.attachments.length > 0) {
    candidateData.hasResume = true;
    candidateData.resumeFileName = email.attachments[0].filename;

    // In a real implementation, you'd upload the attachment to storage
    // and store the reference
  }

  return candidateData;
};

// List emails from inbox
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

        // Apply filters
        let searchCriteria = ["UNSEEN"];
        if (filters.dateFilter === "today") {
          searchCriteria.push([
            "SINCE",
            new Date().toISOString().split("T")[0],
          ]);
        } else if (filters.dateFilter === "week") {
          const lastWeek = new Date();
          lastWeek.setDate(lastWeek.getDate() - 7);
          searchCriteria.push(["SINCE", lastWeek.toISOString().split("T")[0]]);
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

          // Create a fetch for retrieving email headers
          const fetch = imap.fetch(results, {
            bodies: ["HEADER.FIELDS (FROM TO SUBJECT DATE)"],
            struct: true,
          });

          fetch.on("message", (msg, seqno) => {
            const email = { id: seqno, hasAttachments: false };

            msg.on("body", (stream, info) => {
              let buffer = "";
              stream.on("data", (chunk) => {
                buffer += chunk.toString("utf8");
              });

              stream.on("end", () => {
                const header = Imap.parseHeader(buffer);
                email.from = {
                  name: header.from[0].split("<")[0].trim(),
                  email: header.from[0].match(/<(.+)>/)?.[1] || header.from[0],
                };
                email.subject = header.subject[0];
                email.receivedAt = header.date[0];
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
                      attachments.push({
                        id: `att-${seqno}-${attachments.length + 1}`,
                        name: part.params.name,
                        contentType:
                          part.type.toLowerCase() +
                          "/" +
                          part.subtype.toLowerCase(),
                        size: part.size || 0,
                        isResume: /\.(pdf|doc|docx|rtf|txt|odt)$/i.test(
                          part.params.name
                        ),
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
              emails.push(email);
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

    imap.connect();
  });
};

// Process selected emails and import candidates
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

        // Create a fetch for full email content
        const fetch = imap.fetch(emailIds, { bodies: "", struct: true });

        fetch.on("message", (msg, seqno) => {
          msg.on("body", async (stream, info) => {
            try {
              // Parse the email content
              const email = await simpleParser(stream);
              processedEmails.push(seqno);

              // Extract candidate information
              const candidateData = parseCandidateFromEmail(email);

              // Add to database
              const result = await addCandidateFromEmail(candidateData);
              candidates.push({ ...candidateData, id: result.id });
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
          imap.end();
          resolve({ processed: processedEmails.length, candidates });
        });
      });
    });

    imap.once("error", (err) => {
      reject(err);
    });

    imap.connect();
  });
};

module.exports = {
  listEmails,
  processEmails,
};
