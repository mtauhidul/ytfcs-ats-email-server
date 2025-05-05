// server/api/parse-resume.js

const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { OpenAI } = require("openai");
const cors = require("cors");
const util = require("util");
const readFile = util.promisify(fs.readFile);

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadsDir = path.join(__dirname, "../uploads");
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

// Custom render function that's more tolerant of errors
function renderPage(pageData) {
  let renderOptions = {
    normalizeWhitespace: true,
    disableCombineTextItems: false,
  };

  return pageData
    .getTextContent(renderOptions)
    .then(function (textContent) {
      let text = "";
      let lastY = -1;
      let lastX = -1;

      for (let item of textContent.items) {
        if (
          lastY !== item.transform[5] ||
          Math.abs(lastX - item.transform[4]) > 10
        ) {
          text += "\n";
        } else if (lastX !== item.transform[4]) {
          text += " ";
        }

        text += item.str;
        lastY = item.transform[5];
        lastX = item.transform[4] + item.width;
      }

      return text;
    })
    .catch(function (err) {
      // Even if there's an error, try to continue with other pages
      console.warn("Error in page rendering, continuing:", err);
      return "";
    });
}

// Extract text from PDF using pdf-parse
async function extractTextWithPdfParse(filePath) {
  try {
    const pdfParse = require("pdf-parse");
    const dataBuffer = fs.readFileSync(filePath);

    // Try with default options first
    try {
      const data = await pdfParse(dataBuffer);
      return data.text;
    } catch (pdfError) {
      console.warn(
        "Initial PDF parsing failed, trying with fallback options:",
        pdfError.message
      );

      // If the error is related to XRef or other format issues, try with more tolerant options
      if (
        pdfError.message.includes("XRef") ||
        pdfError.message.includes("cross-reference") ||
        pdfError.message.includes("FormatError")
      ) {
        try {
          // Try again with more forgiving options
          const options = {
            pagerender: renderPage,
            max: 0, // No page limit
            version: "v2.0.550", // Use a specific version of pdf.js
          };

          const data = await pdfParse(dataBuffer, options);
          if (data.text && data.text.length > 0) {
            return data.text;
          } else {
            throw new Error("Parsed PDF but no text was extracted");
          }
        } catch (fallbackError) {
          console.error("Fallback PDF parsing also failed:", fallbackError);
          throw fallbackError;
        }
      } else {
        // Not an XRef error, rethrow the original error
        throw pdfError;
      }
    }
  } catch (error) {
    console.error("Error extracting text with pdf-parse:", error);
    throw error;
  }
}

// Extract text from PDF using pdf2json
async function extractTextWithPdf2json(filePath) {
  return new Promise((resolve, reject) => {
    const PDFParser = require("pdf2json");
    const pdfParser = new PDFParser();

    pdfParser.on("pdfParser_dataError", (errData) => {
      reject(new Error(errData.parserError));
    });

    pdfParser.on("pdfParser_dataReady", (pdfData) => {
      try {
        // Convert PDF data to text
        let text = "";
        for (let i = 0; i < pdfData.Pages.length; i++) {
          const page = pdfData.Pages[i];
          for (let j = 0; j < page.Texts.length; j++) {
            const textItem = page.Texts[j];
            for (let k = 0; k < textItem.R.length; k++) {
              text += decodeURIComponent(textItem.R[k].T) + " ";
            }
          }
          text += "\n\n"; // Add page breaks
        }
        resolve(text);
      } catch (error) {
        reject(error);
      }
    });

    pdfParser.loadPDF(filePath);
  });
}

// Extract text from PDF using pdfjs-dist with dynamic import
async function extractTextWithPdfJs(filePath) {
  try {
    // Use dynamic import for ESM compatibility
    const pdfjsLib = await import("pdfjs-dist");

    // Read the PDF file into a buffer
    const dataBuffer = fs.readFileSync(filePath);
    const data = new Uint8Array(dataBuffer);

    // Load the PDF document
    const loadingTask = pdfjsLib.getDocument({ data });
    const pdfDocument = await loadingTask.promise;
    let extractedText = "";

    // Process each page
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Extract text from page
      const pageText = textContent.items.map((item) => item.str).join(" ");

      extractedText += pageText + "\n\n";
    }

    return extractedText;
  } catch (error) {
    console.error("Error extracting text with pdfjs-dist:", error);
    throw error;
  }
}

// Main PDF text extraction function with multiple fallbacks
async function extractTextFromPDF(filePath) {
  let errors = [];

  // Try with pdf-parse first
  try {
    const text = await extractTextWithPdfParse(filePath);
    if (text && text.trim().length > 0) {
      console.log("Successfully extracted text with pdf-parse");
      return text;
    }
  } catch (pdfParseError) {
    console.warn("pdf-parse extraction failed:", pdfParseError.message);
    errors.push(`pdf-parse: ${pdfParseError.message}`);
  }

  // Try with pdf2json second
  try {
    const text = await extractTextWithPdf2json(filePath);
    if (text && text.trim().length > 0) {
      console.log("Successfully extracted text with pdf2json");
      return text;
    }
  } catch (pdf2jsonError) {
    console.warn("pdf2json extraction failed:", pdf2jsonError.message);
    errors.push(`pdf2json: ${pdf2jsonError.message}`);
  }

  // Try with pdfjs-dist last
  try {
    const text = await extractTextWithPdfJs(filePath);
    if (text && text.trim().length > 0) {
      console.log("Successfully extracted text with pdfjs-dist");
      return text;
    }
  } catch (pdfjsError) {
    console.warn("pdfjs-dist extraction failed:", pdfjsError.message);
    errors.push(`pdfjs-dist: ${pdfjsError.message}`);
  }

  // If we get here, all methods failed
  throw new Error(
    `Failed to extract text from PDF after trying multiple libraries. Errors: ${errors.join("; ")}`
  );
}

// Extract text from DOC/DOCX using mammoth
async function extractTextFromDOCX(filePath) {
  try {
    const mammoth = require("mammoth");
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
    // Check which model is being used
    const model = process.env.OPENAI_MODEL || "gpt-3.5-turbo"; // Default to 3.5 if not specified

    // Create the base request
    const requestOptions = {
      model: model,
      messages: [
        {
          role: "system",
          content: `You are a resume parsing expert. Extract structured information from the resume text provided. 
          Extract the following information if available:
          - Full Name
          - Email address
          - Phone number
          - LinkedIn URL
          - Location (City, State, Country)
          - Education details (institution, degree, year)
          - Total years of experience (calculate if possible)
          - Current or most recent job title
          - Technical and soft skills
          - Languages spoken
          
          Format your response as a valid JSON object with these fields:
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
          
          Be accurate and extract as much information as possible. If any field cannot be found, set it to null or an empty array as appropriate.`,
        },
        {
          role: "user",
          content: `Parse the following resume: ${text}`,
        },
      ],
      temperature: 0.2,
    };

    // Add response_format only for models that support it
    if (
      model.includes("gpt-4") ||
      model.includes("gpt-3.5-turbo-1106") ||
      model.includes("gpt-3.5-turbo-0125")
    ) {
      requestOptions.response_format = { type: "json_object" };
    }

    const response = await openai.chat.completions.create(requestOptions);

    // Extract the content from the response
    const responseContent = response.choices[0].message.content;

    // Parse the response as JSON, handling potential errors
    let parsedResume;
    try {
      parsedResume = JSON.parse(responseContent);
    } catch (parseError) {
      console.error("Error parsing OpenAI response as JSON:", responseContent);
      // Try to extract JSON using regex as a fallback
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsedResume = JSON.parse(jsonMatch[0]);
        } catch (e) {
          throw new Error("Failed to parse AI response as JSON");
        }
      } else {
        throw new Error("Failed to extract structured data from resume");
      }
    }

    // Add metadata about the file
    parsedResume.originalFilename = fileName;
    parsedResume.resumeText = parsedResume.resumeText || text;
    parsedResume.parsingTimestamp = new Date().toISOString();

    return parsedResume;
  } catch (error) {
    console.error("Error parsing resume with OpenAI:", error);
    throw new Error(
      `Failed to parse resume with AI: ${error.message || "Unknown error"}`
    );
  }
}

// Enable CORS for the router
router.use(cors());

// Resume parsing endpoint
router.post("/parse", upload.single("file"), async (req, res, next) => {
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
    try {
      if (fileExtension === ".pdf") {
        text = await extractTextFromPDF(filePath);

        // Check if text was successfully extracted
        if (!text || text.trim().length === 0) {
          throw new Error(
            "PDF parsed but no text could be extracted. The PDF might be image-based or secured."
          );
        }
      } else if (fileExtension === ".doc" || fileExtension === ".docx") {
        text = await extractTextFromDOCX(filePath);
      } else {
        // This should not happen due to fileFilter, but just in case
        return res
          .status(400)
          .json({ success: false, error: "Unsupported file type" });
      }
    } catch (extractionError) {
      console.error("Text extraction error:", extractionError);
      return res.status(422).json({
        success: false,
        error: `Failed to extract text from the ${fileExtension} file: ${extractionError.message}`,
        details: extractionError.details || extractionError.message,
        suggestion:
          fileExtension === ".pdf"
            ? "The PDF may be corrupted, password-protected, or contains only images. Try converting it to text first or use a different file."
            : "The document may be corrupted or has an unsupported format. Try saving as a different format.",
      });
    }

    // Parse the resume text with OpenAI
    try {
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
    } catch (parsingError) {
      console.error("Resume parsing error:", parsingError);
      return res.status(500).json({
        success: false,
        error: "Failed to parse resume content",
        details: parsingError.message,
        suggestion: "Try a different resume file or format.",
      });
    }
  } catch (error) {
    // Clean up file if exists
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.warn("Failed to clean up file:", cleanupError);
      }
    }

    // Pass to error handler with more details
    error.statusCode = error.statusCode || 500;
    error.detail = `Error processing ${req.file ? req.file.originalname : "file"}: ${error.message}`;
    next(error);
  }
});

// Email attachment parsing endpoint - for PDF, DOC/DOCX, and TXT
router.post(
  "/parse-attachment",
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
      try {
        if (fileExtension === ".pdf") {
          text = await extractTextFromPDF(filePath);

          // Check if text was successfully extracted
          if (!text || text.trim().length === 0) {
            throw new Error(
              "PDF parsed but no text could be extracted. The PDF might be image-based or secured."
            );
          }
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
      } catch (extractionError) {
        console.error("Text extraction error:", extractionError);
        return res.status(422).json({
          success: false,
          error: `Failed to extract text from the ${fileExtension} file: ${extractionError.message}`,
          details: extractionError.details || extractionError.message,
          suggestion:
            fileExtension === ".pdf"
              ? "The PDF may be corrupted, password-protected, or contains only images. Try converting it to text first or use a different file."
              : "The document may be corrupted or has an unsupported format. Try saving as a different format.",
        });
      }

      // Parse the resume text with OpenAI
      try {
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
      } catch (parsingError) {
        console.error("Resume parsing error:", parsingError);
        return res.status(500).json({
          success: false,
          error: "Failed to parse resume content",
          details: parsingError.message,
          suggestion: "Try a different resume file or format.",
        });
      }
    } catch (error) {
      // Clean up file if exists
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (cleanupError) {
          console.warn("Failed to clean up file:", cleanupError);
        }
      }

      // Pass to error handler with more details
      error.statusCode = error.statusCode || 500;
      error.detail = `Error processing ${req.file ? req.file.originalname : "file"}: ${error.message}`;
      next(error);
    }
  }
);

module.exports = router;
