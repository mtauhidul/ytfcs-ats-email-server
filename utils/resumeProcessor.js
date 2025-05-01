// utils/resumeProcessor.js

const fs = require("fs").promises;
const path = require("path");
const logger = require("./logger");
const axios = require("axios");
const FormData = require("form-data");

/**
 * Creates a temporary directory for file processing
 * @returns {Promise<string>} Path to the temp directory
 */
const createTempDir = async () => {
  const tempDir = path.join(__dirname, "../temp", `${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
};

/**
 * Processes an email attachment and extracts candidate information
 * @param {Object} attachment - Email attachment metadata
 * @param {Buffer} content - Attachment content
 * @returns {Promise<Object>} Extracted candidate data
 */
const processAttachment = async (attachment, content) => {
  try {
    // Check if file type is supported
    const fileName = attachment.name.toLowerCase();
    const supportedTypes = [".pdf", ".doc", ".docx", ".txt", ".rtf", ".odt"];

    if (!supportedTypes.some((ext) => fileName.endsWith(ext))) {
      throw new Error(`Unsupported file type: ${attachment.name}`);
    }

    // Create a temp directory and file
    const tempDir = await createTempDir();
    const tempFile = path.join(tempDir, attachment.name);

    try {
      // Write the content to a temp file
      await fs.writeFile(tempFile, content);

      // Use our existing resume parsing API
      const formData = new FormData();
      formData.append("file", await fs.readFile(tempFile), attachment.name);

      // Call the internal parse API endpoint
      const response = await axios.post(
        "http://localhost:" + (process.env.PORT || 3001) + "/api/resume/parse",
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            "x-api-key": process.env.API_KEY,
          },
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.error || "Failed to parse resume");
      }

      // Get the parsed data
      const parsedData = response.data.data;

      // Add source information
      return {
        ...parsedData,
        source: "email_attachment",
        importMethod: "ai_parser",
        originalFilename: attachment.name,
        fileSize: attachment.size,
        fileType: attachment.contentType,
      };
    } finally {
      // Clean up temp files
      try {
        await fs.unlink(tempFile);
        await fs.rmdir(tempDir);
      } catch (cleanupError) {
        logger.warn("Failed to clean up temp files:", cleanupError);
      }
    }
  } catch (error) {
    // If API parsing fails, fall back to basic extraction
    logger.error(`Error processing attachment ${attachment.name}:`, error);

    // Return basic information
    return {
      name: "Unknown Candidate",
      email: null,
      source: "email_attachment",
      importMethod: "basic_extraction",
      originalFilename: attachment.name,
      fileSize: attachment.size,
      fileType: attachment.contentType,
      hasResume: true,
      resumeFileName: attachment.name,
    };
  }
};

/**
 * Extract basic candidate information from email and attachment
 * @param {string} fromName - Sender's name
 * @param {string} fromEmail - Sender's email
 * @param {string} subject - Email subject
 * @returns {Object} Basic candidate data
 */
const extractBasicCandidateInfo = (fromName, fromEmail, subject) => {
  return {
    name: fromName || "Unknown Candidate",
    email: fromEmail,
    source: "email_import",
    importMethod: "manual",
    importDate: new Date().toISOString(),
    notes: `Imported from email with subject: ${subject}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [
      {
        date: new Date().toISOString(),
        note: `Imported from email with subject: "${subject}"`,
      },
    ],
  };
};

/**
 * Cleans up temporary resources created during processing
 * @param {string} tempDir - Path to temp directory
 * @returns {Promise<void>}
 */
const cleanupTempResources = async (tempDir) => {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    logger.warn(`Error cleaning up temp resources at ${tempDir}:`, error);
  }
};

module.exports = {
  processAttachment,
  extractBasicCandidateInfo,
  createTempDir,
  cleanupTempResources,
};
