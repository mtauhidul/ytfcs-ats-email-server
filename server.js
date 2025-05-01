// Main application entry point
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bodyParser = require("body-parser");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { errorHandler } = require("./middleware/errorHandler");
const { OpenAI } = require("openai");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

// Route imports
const notificationRoutes = require("./routes/notifications");
const communicationRoutes = require("./routes/communications");
const webhookRoutes = require("./routes/webhooks");
const importRoutes = require("./routes/import");
const emailImportRoutes = require("./routes/email-import"); // Add new email import routes

const app = express();
const PORT = process.env.PORT || 3001;

// Apply basic security middleware
app.use(helmet());
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));

// Apply rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests, please try again later.",
});

// Apply rate limiting to all routes
app.use(apiLimiter);

// Routes
app.use("/api/email/notifications", notificationRoutes);
app.use("/api/email/communications", communicationRoutes);
app.use("/api/email/webhooks", webhookRoutes);
app.use("/api/email/import", importRoutes);
// Mount email import routes at a more specific path to avoid conflicts
app.use("/api/email/inbox", emailImportRoutes); // Changed path to /api/email/inbox

// Simple health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// ----- RESUME PARSER INTEGRATION STARTS HERE -----

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadsDir = path.join(__dirname, "uploads");
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    // Create unique filename with original extension
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

// File type validation
const fileFilter = (req, file, cb) => {
  // Accept only PDF, DOC, and DOCX files
  if (
    file.mimetype === "application/pdf" ||
    file.mimetype === "application/msword" ||
    file.mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Invalid file type. Only PDF, DOC, and DOCX files are allowed."
      ),
      false
    );
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max file size
});

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Extract text from PDF
async function extractTextFromPDF(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (error) {
    console.error("Error extracting text from PDF:", error);
    throw new Error("Failed to extract text from PDF");
  }
}

// Extract text from DOC/DOCX
async function extractTextFromDOCX(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } catch (error) {
    console.error("Error extracting text from DOCX:", error);
    throw new Error("Failed to extract text from DOC/DOCX");
  }
}

// Parse resume text using OpenAI
async function parseResumeWithOpenAI(text, fileName) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4", // You can use "gpt-3.5-turbo" for lower cost
      messages: [
        {
          role: "system",
          content: `You are a resume parsing expert. Extract structured information from the resume text provided. 
          Return a JSON object with the following fields if they can be found:
          {
            "name": "Full Name",
            "email": "Email address",
            "phone": "Phone number",
            "linkedIn": "LinkedIn URL if available",
            "location": "City, State, Country",
            "education": "Education details formatted as institution, degree, year if available",
            "experience": "Total years of experience (calculate if possible, otherwise provide as is)",
            "jobTitle": "Current or most recent job title",
            "skills": ["Array", "of", "technical", "and", "soft", "skills"],
            "languages": ["Array", "of", "languages", "spoken"],
            "resumeText": "The original text of the resume"
          }
          
          Be accurate and extract as much information as possible. If any field cannot be found, set it to null or an empty array.`,
        },
        {
          role: "user",
          content: `Parse the following resume: ${text}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    // Parse the response JSON
    const parsedResume = JSON.parse(response.choices[0].message.content);

    // Add metadata about the file
    parsedResume.originalFilename = fileName;

    return parsedResume;
  } catch (error) {
    console.error("Error parsing resume with OpenAI:", error);
    throw new Error("Failed to parse resume with AI");
  }
}

// Resume parsing endpoint
app.post("/api/resume/parse", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "No file uploaded" });
    }

    const filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();

    // Extract text based on file type
    let text;
    if (fileExtension === ".pdf") {
      text = await extractTextFromPDF(filePath);
    } else if (fileExtension === ".doc" || fileExtension === ".docx") {
      text = await extractTextFromDOCX(filePath);
    } else {
      // This should not happen due to fileFilter, but just in case
      return res
        .status(400)
        .json({ success: false, error: "Unsupported file type" });
    }

    // Parse the resume text with OpenAI
    const parsedResume = await parseResumeWithOpenAI(
      text,
      req.file.originalname
    );

    // Clean up the temporary file
    fs.unlinkSync(filePath);

    // Return the parsed resume data
    return res.json({
      success: true,
      data: parsedResume,
    });
  } catch (error) {
    // Pass to error handler
    next(error);
  }
});

// ----- RESUME PARSER INTEGRATION ENDS HERE -----

// ----- EMAIL ATTACHMENT PARSING ENDPOINT -----
// This endpoint allows parsing resume attachments from emails
app.post(
  "/api/email/parse-attachment",
  upload.single("attachment"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, error: "No attachment uploaded" });
      }

      const filePath = req.file.path;
      const fileExtension = path.extname(req.file.originalname).toLowerCase();

      // Extract text based on file type
      let text;
      if (fileExtension === ".pdf") {
        text = await extractTextFromPDF(filePath);
      } else if (fileExtension === ".doc" || fileExtension === ".docx") {
        text = await extractTextFromDOCX(filePath);
      } else if (fileExtension === ".txt") {
        // For text files, just read the content
        text = fs.readFileSync(filePath, "utf8");
      } else {
        return res
          .status(400)
          .json({ success: false, error: "Unsupported file type" });
      }

      // Parse the resume text with OpenAI
      const parsedResume = await parseResumeWithOpenAI(
        text,
        req.file.originalname
      );

      // Add source information
      parsedResume.source = "email_attachment";
      parsedResume.importMethod = "ai_parser";

      // Clean up the temporary file
      fs.unlinkSync(filePath);

      // Return the parsed resume data
      return res.json({
        success: true,
        data: parsedResume,
      });
    } catch (error) {
      // Clean up file if exists
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (cleanupError) {
          console.warn("Failed to clean up file:", cleanupError);
        }
      }

      // Pass to error handler
      next(error);
    }
  }
);

// For debugging purposes - to help identify route issues
app.use((req, res, next) => {
  console.log(`404 Not Found: ${req.method} ${req.originalUrl}`);
  next();
});

// Error handling middleware
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
