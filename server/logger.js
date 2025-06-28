// Simple logging helpers that prepend a timestamp and log level.
module.exports = {
  /**
   * Log an informational message to stdout with a timestamp.
   * @param {...any} args - Message parts to log
   */
  info: (...args) => {
    console.log(new Date().toISOString(), '[INFO]', ...args);
  },

  /**
   * Log an error message to stderr with a timestamp.
   * @param {...any} args - Message parts to log
   */
  error: (...args) => {
    console.error(new Date().toISOString(), '[ERROR]', ...args);
  }
};
