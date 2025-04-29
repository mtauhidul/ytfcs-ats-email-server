// Main application entry point
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bodyParser = require("body-parser");
const { errorHandler } = require("./middleware/errorHandler");

// Route imports
const notificationRoutes = require("./routes/notifications");
const communicationRoutes = require("./routes/communications");
const webhookRoutes = require("./routes/webhooks");
const importRoutes = require("./routes/import");

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

// Simple health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Error handling middleware
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
