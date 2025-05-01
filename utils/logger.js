// utils/logger.js

/**
 * Simple logging utility for consistent log formatting
 * In a production environment, this would be replaced with a more robust
 * logging solution like Winston or Pino
 */

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

// Get log level from environment variable or default to INFO
const currentLogLevel =
  LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] || LOG_LEVELS.INFO;

/**
 * Format the current timestamp for logs
 * @returns {string} Formatted timestamp
 */
const getTimestamp = () => {
  return new Date().toISOString();
};

/**
 * Format a log message
 * @param {string} level - Log level
 * @param {Array<any>} args - Log arguments
 * @returns {string} Formatted log message
 */
const formatLog = (level, args) => {
  const timestamp = getTimestamp();
  const message = args
    .map((arg) => {
      if (typeof arg === "object") {
        return JSON.stringify(arg, null, 2);
      }
      return String(arg);
    })
    .join(" ");

  return `${timestamp} [${level}] ${message}`;
};

/**
 * Log error message
 * @param {...any} args - Log arguments
 */
const error = (...args) => {
  if (currentLogLevel >= LOG_LEVELS.ERROR) {
    console.error(formatLog("ERROR", args));
  }
};

/**
 * Log warning message
 * @param {...any} args - Log arguments
 */
const warn = (...args) => {
  if (currentLogLevel >= LOG_LEVELS.WARN) {
    console.warn(formatLog("WARN", args));
  }
};

/**
 * Log info message
 * @param {...any} args - Log arguments
 */
const info = (...args) => {
  if (currentLogLevel >= LOG_LEVELS.INFO) {
    console.log(formatLog("INFO", args));
  }
};

/**
 * Log debug message
 * @param {...any} args - Log arguments
 */
const debug = (...args) => {
  if (currentLogLevel >= LOG_LEVELS.DEBUG) {
    console.log(formatLog("DEBUG", args));
  }
};

/**
 * Create a scoped logger
 * @param {string} scope - Logger scope
 * @returns {Object} Scoped logger
 */
const createScopedLogger = (scope) => {
  return {
    error: (...args) => error(`[${scope}]`, ...args),
    warn: (...args) => warn(`[${scope}]`, ...args),
    info: (...args) => info(`[${scope}]`, ...args),
    debug: (...args) => debug(`[${scope}]`, ...args),
  };
};

module.exports = {
  error,
  warn,
  info,
  debug,
  createScopedLogger,
};
