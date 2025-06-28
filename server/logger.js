// Simple logging helpers that prepend a timestamp and log level.
module.exports = {
  info: (...args) => {
    console.log(new Date().toISOString(), '[INFO]', ...args);
  },
  error: (...args) => {
    console.error(new Date().toISOString(), '[ERROR]', ...args);
  }
};
