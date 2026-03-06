/**
 * Logger Utility
 * Provides structured logging for production environment
 * Replaces console.log with proper logging levels
 */

const fs = require('fs');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG',
};

const LOG_LEVEL_PRIORITY = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

class Logger {
  constructor(module) {
    this.module = module;
    this.currentLogLevel = process.env.LOG_LEVEL || 'INFO';
  }

  _formatTimestamp() {
    const now = new Date();
    return now.toISOString();
  }

  _formatLog(level, message, meta = {}) {
    const timestamp = this._formatTimestamp();
    const logEntry = {
      timestamp,
      level,
      module: this.module,
      message,
      ...meta,
    };
    return logEntry;
  }

  _shouldLog(level) {
    const currentPriority = LOG_LEVEL_PRIORITY[this.currentLogLevel] || 2;
    const logPriority = LOG_LEVEL_PRIORITY[level] || 2;
    return logPriority <= currentPriority;
  }

  _writeLog(level, logEntry) {
    if (!this._shouldLog(level)) return;

    const logMessage = JSON.stringify(logEntry);

    // Write to console in development
    if (process.env.NODE_ENV !== 'production') {
      const colorCode = {
        ERROR: '\x1b[31m',    // Red
        WARN: '\x1b[33m',     // Yellow
        INFO: '\x1b[36m',     // Cyan
        DEBUG: '\x1b[35m',    // Magenta
      };
      const reset = '\x1b[0m';
      console.log(`${colorCode[level] || ''}[${logEntry.timestamp}] [${level}] ${logEntry.module}: ${logEntry.message}${reset}`, 
        Object.keys(logEntry).length > 4 ? logEntry : '');
    }

    // Write to file in production
    if (process.env.NODE_ENV === 'production') {
      const logFile = path.join(logsDir, `${level.toLowerCase()}.log`);
      fs.appendFileSync(logFile, logMessage + '\n');
    }
  }

  error(message, meta = {}) {
    const logEntry = this._formatLog(LOG_LEVELS.ERROR, message, meta);
    this._writeLog(LOG_LEVELS.ERROR, logEntry);
  }

  warn(message, meta = {}) {
    const logEntry = this._formatLog(LOG_LEVELS.WARN, message, meta);
    this._writeLog(LOG_LEVELS.WARN, logEntry);
  }

  info(message, meta = {}) {
    const logEntry = this._formatLog(LOG_LEVELS.INFO, message, meta);
    this._writeLog(LOG_LEVELS.INFO, logEntry);
  }

  debug(message, meta = {}) {
    const logEntry = this._formatLog(LOG_LEVELS.DEBUG, message, meta);
    this._writeLog(LOG_LEVELS.DEBUG, logEntry);
  }
}

// Export factory function for creating module-specific loggers
module.exports = (moduleName) => {
  return new Logger(moduleName);
};

// Export LOG_LEVELS for reference
module.exports.LOG_LEVELS = LOG_LEVELS;
