// services/firebaseService.js

// Firebase integration
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

// Initialize Firebase app
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Get candidate by ID
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

// Get team member by ID
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

// Update message status
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

// Add candidate from email import
const addCandidateFromEmail = async (candidateData) => {
  try {
    // Check if candidate with this email already exists
    if (candidateData.email) {
      const querySnapshot = await db
        .collection("candidates")
        .where("email", "==", candidateData.email)
        .limit(1)
        .get();

      if (!querySnapshot.empty) {
        // Candidate exists, update instead of create
        const existingDoc = querySnapshot.docs[0];
        await existingDoc.ref.update({
          ...candidateData,
          updatedAt: new Date().toISOString(),
        });

        return { id: existingDoc.id, updated: true, created: false };
      }
    }

    // Create new candidate
    const docRef = await db.collection("candidates").add({
      ...candidateData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return { id: docRef.id, updated: false, created: true };
  } catch (error) {
    logger.error("Error adding candidate from email import:", error);
    throw new Error(`Failed to add candidate: ${error.message}`);
  }
};

module.exports = {
  db,
  getCandidate,
  getTeamMember,
  updateMessageStatus,
  addCandidateFromEmail,
};
