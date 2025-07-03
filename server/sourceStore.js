const fs = require('fs');
const path = require('path');
const config = require('./config');

// Path where custom sources are stored. Using a JSON file keeps
// things simple and avoids additional database schema changes.
const file = path.join(__dirname, '../sources.json');

/**
 * Persist the current source configuration to disk.
 * Both tender and award sources are written so they can be
 * restored on the next server start.
 */
function save() {
  const data = {
    sources: config.sources,
    awardSources: config.awardSources
  };
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    // Log the failure but don't crash the server.
    require('./logger').error('Failed to save sources:', err);
  }
}

/**
 * Load previously saved sources from disk if the file exists.
 * The data is merged into the config object so defaults remain intact.
 */
function load() {
  if (!fs.existsSync(file)) return;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    if (data.sources) {
      for (const [k, v] of Object.entries(data.sources)) {
        config.sources[k] = v;
      }
    }
    if (data.awardSources) {
      for (const [k, v] of Object.entries(data.awardSources)) {
        config.awardSources[k] = v;
      }
    }
  } catch (err) {
    require('./logger').error('Failed to load sources:', err);
  }
}

module.exports = { save, load };
