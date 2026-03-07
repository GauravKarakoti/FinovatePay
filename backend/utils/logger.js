const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log levels and colors
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const level = () => {
  const env = process.env.NODE_ENV || 'development';
  const isDevelopment = env === 'development';
  return isDevelopment ? 'debug' : 'warn';
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

// Define log format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `[${info.timestamp}] [${info.level}] [${info.module || 'app'}]: ${info.message}`,
  ),
);

// Configure separate log files
const transports = [
  new winston.transports.Console(),
  new winston.transports.File({
    filename: path.join(logsDir, 'error.log'),
    level: 'error',
    handleExceptions: true,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }),
  new winston.transports.File({ filename: path.join(logsDir, 'all.log') }),
];

// Factory function to create a logger for a specific module
const createLogger = (moduleName = 'app') => {
  return winston.createLogger({
    level: level(),
    levels,
    format,
    transports,
    defaultMeta: { module: moduleName },
  });
};

// Export factory function
module.exports = createLogger;

// Export LOG_LEVELS for compatibility
module.exports.LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug'
};
