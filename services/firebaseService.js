// services/firebaseService.js

const admin = require("firebase-admin");
const logger = require("../utils/logger");

// Initialize Firebase with credentials from environment variables
let serviceAccount;

try {
  // Check for Base64 encoded credentials first
  if (process.env.FIREBASE_CREDENTIALS_BASE64) {
    const base64Credentials = process.env.FIREBASE_CREDENTIALS_BASE64;
    const jsonString = Buffer.from(base64Credentials, "base64").toString(
      "utf8"
    );
    serviceAccount = JSON.parse(jsonString);
    logger.info("Firebase credentials loaded from base64 environment variable");
  }
  // Fall back to JSON string if Base64 not available
  else if (process.env.FIREBASE_CREDENTIALS) {
    serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    logger.info("Firebase credentials loaded from JSON environment variable");
  }
  // Fall back to file path as last resort
  else if (process.env.FIREBASE_CREDENTIAL_JSON) {
    serviceAccount = require(process.env.FIREBASE_CREDENTIAL_JSON);
    logger.info("Firebase credentials loaded from file path");
  } else {
    throw new Error(
      "No Firebase credentials found in environment variables or file path"
    );
  }
} catch (error) {
  logger.error("Error initializing Firebase credentials:", error);
  throw new Error(`Failed to initialize Firebase: ${error.message}`);
}

// Initialize Firebase app if not already initialized
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

/**
 * Get candidate by ID
 * @param {string} candidateId - Candidate ID
 * @returns {Promise<Object>} Candidate data
 */
const getCandidate = async (candidateId) => {
  try {
    const docRef = db.collection("candidates").doc(candidateId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new Error(`Candidate with ID ${candidateId} not found`);
    }

    return { id: doc.id, ...doc.data() };
  } catch (error) {
    logger.error(`Error fetching candidate with ID ${candidateId}:`, error);
    throw new Error(`Failed to retrieve candidate: ${error.message}`);
  }
};

/**
 * Check if candidate with given email already exists
 * @param {string} email - Candidate email
 * @returns {Promise<Object|null>} Existing candidate or null
 */
const checkCandidateExists = async (email) => {
  try {
    if (!email) return null;

    const querySnapshot = await db
      .collection("candidates")
      .where("email", "==", email)
      .limit(1)
      .get();

    if (querySnapshot.empty) {
      return null;
    }

    const doc = querySnapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  } catch (error) {
    logger.error(
      `Error checking if candidate exists with email ${email}:`,
      error
    );
    throw new Error(`Failed to check candidate existence: ${error.message}`);
  }
};

/**
 * Add candidate from email import with deduplication
 * @param {Object} candidateData - Candidate information
 * @returns {Promise<Object>} Result of the operation
 */
const addCandidateFromEmail = async (candidateData) => {
  try {
    // Check if candidate with this email already exists
    if (candidateData.email) {
      const existingCandidate = await checkCandidateExists(candidateData.email);

      if (existingCandidate) {
        // Update the history with a new entry about this import attempt
        const history = existingCandidate.history || [];
        history.push({
          date: new Date().toISOString(),
          note: `Another email received with subject: "${candidateData.notes.replace("Imported from email: ", "")}"`,
        });

        // Update the existing candidate with new information
        await db
          .collection("candidates")
          .doc(existingCandidate.id)
          .update({
            updatedAt: new Date().toISOString(),
            history,
            // Only update fields that don't already exist
            ...(!existingCandidate.source && { source: candidateData.source }),
            ...(!existingCandidate.hasResume &&
              candidateData.hasResume && {
                hasResume: candidateData.hasResume,
                resumeFileName: candidateData.resumeFileName,
              }),
          });

        return {
          id: existingCandidate.id,
          updated: true,
          created: false,
          alreadyExists: true,
        };
      }
    }

    // Check if candidate data is valid
    if (!candidateData.name) {
      throw new Error("Candidate name is required");
    }

    // Add default fields if not present
    const completeData = {
      ...candidateData,
      createdAt: candidateData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stageId: candidateData.stageId || "",
      tags: candidateData.tags || [],
      rating: candidateData.rating || 0,
      // If email is missing, add it with a placeholder to avoid null references
      email:
        candidateData.email ||
        `unknown-${new Date().getTime()}@placeholder.com`,
    };

    // Create new candidate using batch write for atomicity
    const batch = db.batch();
    const newCandidateRef = db.collection("candidates").doc();
    batch.set(newCandidateRef, completeData);

    // If there are other related operations, they can be added to the batch

    // Commit the batch
    await batch.commit();

    logger.info(`Added new candidate from email: ${completeData.name}`);

    return {
      id: newCandidateRef.id,
      updated: false,
      created: true,
      alreadyExists: false,
    };
  } catch (error) {
    logger.error("Error adding candidate from email import:", error);
    throw new Error(`Failed to add candidate: ${error.message}`);
  }
};

/**
 * Add multiple candidates in batch
 * @param {Array<Object>} candidatesData - Array of candidate information
 * @returns {Promise<Object>} Results of batch operation
 */
const batchAddCandidates = async (candidatesData) => {
  try {
    if (!Array.isArray(candidatesData) || candidatesData.length === 0) {
      return { success: false, message: "No candidates to add" };
    }

    const batch = db.batch();
    const results = {
      totalProcessed: candidatesData.length,
      added: 0,
      updated: 0,
      failed: 0,
      ids: [],
    };

    // First, check which emails already exist
    const uniqueEmails = [
      ...new Set(candidatesData.filter((c) => c.email).map((c) => c.email)),
    ];

    let existingEmailsMap = {};

    if (uniqueEmails.length > 0) {
      // Firestore "in" queries are limited to 10 values
      // For larger sets, we'd need to break this into chunks
      const chunkSize = 10;
      const emailChunks = [];

      for (let i = 0; i < uniqueEmails.length; i += chunkSize) {
        emailChunks.push(uniqueEmails.slice(i, i + chunkSize));
      }

      // Process each chunk
      for (const chunk of emailChunks) {
        const querySnapshot = await db
          .collection("candidates")
          .where("email", "in", chunk)
          .get();

        querySnapshot.forEach((doc) => {
          const data = doc.data();
          if (data.email) {
            existingEmailsMap[data.email] = {
              id: doc.id,
              ...data,
            };
          }
        });
      }
    }

    // Process each candidate
    for (const candidateData of candidatesData) {
      try {
        const timestamp = new Date().toISOString();

        if (candidateData.email && existingEmailsMap[candidateData.email]) {
          // Update existing candidate
          const existingCandidate = existingEmailsMap[candidateData.email];
          const docRef = db.collection("candidates").doc(existingCandidate.id);

          // Update the history
          const history = existingCandidate.history || [];
          history.push({
            date: timestamp,
            note: `Updated from batch import`,
          });

          batch.update(docRef, {
            updatedAt: timestamp,
            history,
            // Only update non-existent fields
            ...(!existingCandidate.source && { source: candidateData.source }),
            ...(!existingCandidate.hasResume &&
              candidateData.hasResume && {
                hasResume: candidateData.hasResume,
                resumeFileName: candidateData.resumeFileName,
              }),
          });

          results.updated++;
          results.ids.push(existingCandidate.id);
        } else {
          // Add new candidate
          const newCandidateRef = db.collection("candidates").doc();

          // Ensure required fields
          const completeData = {
            ...candidateData,
            createdAt: timestamp,
            updatedAt: timestamp,
            stageId: candidateData.stageId || "",
            tags: candidateData.tags || [],
            rating: candidateData.rating || 0,
            history: [
              {
                date: timestamp,
                note: "Imported from batch operation",
              },
            ],
            // If email is missing, add it with a placeholder
            email:
              candidateData.email ||
              `unknown-${new Date().getTime()}-${results.added}@placeholder.com`,
          };

          batch.set(newCandidateRef, completeData);

          results.added++;
          results.ids.push(newCandidateRef.id);
        }
      } catch (error) {
        logger.error("Error processing candidate in batch:", error);
        results.failed++;
      }
    }

    // Commit the batch
    await batch.commit();

    logger.info(
      `Batch processed ${results.totalProcessed} candidates: added ${results.added}, updated ${results.updated}, failed ${results.failed}`
    );

    return {
      success: true,
      ...results,
    };
  } catch (error) {
    logger.error("Error in batch adding candidates:", error);
    throw new Error(`Failed to process batch: ${error.message}`);
  }
};

/**
 * Update message status
 * @param {string} messageId - Message ID
 * @param {string} status - New status
 * @returns {Promise<Object>} Success indicator
 */
const updateMessageStatus = async (messageId, status) => {
  try {
    const docRef = db.collection("messages").doc(messageId);
    await docRef.update({
      status,
      updatedAt: new Date().toISOString(),
    });

    return { success: true };
  } catch (error) {
    logger.error(
      `Error updating message ${messageId} status to ${status}:`,
      error
    );
    throw new Error(`Failed to update message status: ${error.message}`);
  }
};

/**
 * Get team member by ID
 * @param {string} teamMemberId - Team member ID
 * @returns {Promise<Object>} Team member data
 */
const getTeamMember = async (teamMemberId) => {
  try {
    const docRef = db.collection("teamMembers").doc(teamMemberId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new Error(`Team member with ID ${teamMemberId} not found`);
    }

    return { id: doc.id, ...doc.data() };
  } catch (error) {
    logger.error(`Error fetching team member with ID ${teamMemberId}:`, error);
    throw new Error(`Failed to retrieve team member: ${error.message}`);
  }
};

/**
 * Process and extract data from email attachments (resume parsing)
 * @param {Object} attachment - Email attachment data
 * @param {Object} candidateData - Existing candidate data to enrich
 * @returns {Promise<Object>} Enriched candidate data
 */
const processAttachment = async (attachment, candidateData) => {
  try {
    // In a real implementation, this would:
    // 1. Download the attachment from the email
    // 2. Use OCR/NLP to extract information from the resume
    // 3. Return the enhanced candidate data

    // For now, just add a flag that we have a resume attachment
    return {
      ...candidateData,
      hasResumeAttachment: true,
      resumeFilename: attachment.name,
      resumeFileType: attachment.contentType,
      resumeFileSize: attachment.size,
    };
  } catch (error) {
    logger.error("Error processing attachment:", error);
    // Return original data if processing fails
    return candidateData;
  }
};

module.exports = {
  db,
  getCandidate,
  getTeamMember,
  checkCandidateExists,
  updateMessageStatus,
  addCandidateFromEmail,
  batchAddCandidates,
  processAttachment,
};
