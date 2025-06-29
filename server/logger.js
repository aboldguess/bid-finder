// Simple logging helpers that prepend a timestamp and log level.
// Messages are written to both the console and a log file so that the
// history of events persists across restarts. The log directory is ignored by
// git so it will not pollute the repository.

const fs = require('fs');
const path = require('path');
const util = require('util');

// Ensure the logs directory exists before attempting to write to it. The path
// is resolved relative to the project root so it works regardless of where the
// logger is required from.
const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Open the log file in append mode so entries accumulate over time.
const logPath = path.join(logDir, 'app.log');
const logStream = fs.createWriteStream(logPath, { flags: 'a' });

function write(level, ...args) {
  const timestamp = new Date().toISOString();
  const message = util.format(...args);
  const line = `${timestamp} [${level}] ${message}\n`;
  if (level === 'INFO') {
    console.log(line.trim());
  } else {
    console.error(line.trim());
  }
  logStream.write(line);
}

module.exports = {
  /**
   * Log an informational message to stdout and the persistent log file.
   * @param {...any} args - Message parts to log
   */
  info: (...args) => write('INFO', ...args),

  /**
   * Log an error message to stderr and the persistent log file.
   * @param {...any} args - Message parts to log
   */
  error: (...args) => write('ERROR', ...args)
};
