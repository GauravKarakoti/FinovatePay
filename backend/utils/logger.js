const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log levels and colors
const levels = { error: 0, warn: 1, info: 2, http: 3, debug: 4 };

const level = () => {
  const env = process.env.NODE_ENV || 'development';
  return env === 'development' ? 'debug' : 'info';
};

winston.addColors({
  error: 'red', warn: 'yellow', info: 'green', http: 'magenta', debug: 'white',
});

// Define log format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:SSS' }),
  winston.format.printf(
    (info) => `[${info.timestamp}] [${info.level}] [${info.module || 'app'}]: ${info.message}`,
  ),
);

// Factory function to create a logger for a specific module
const createLogger = (moduleName = 'app') => {
  return winston.createLogger({
    level: level(),
    levels,
    format,
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(winston.format.colorize({ all: true }), format)
      }),
      new winston.transports.File({
        filename: path.join(logsDir, 'error.log'),
        level: 'error',
        // Removed handleExceptions: true to prevent Node.js Memory Leak Warning
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      }),
      new winston.transports.File({ filename: path.join(logsDir, 'all.log') }),
    ],
    defaultMeta: { module: moduleName },
  });
};

module.exports = createLogger;
module.exports.LOG_LEVELS = { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' };