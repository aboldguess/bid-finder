const express = require('express');
const db = require('./db');
const scrape = require('./scrape');
const cron = require('node-cron');
const config = require('./config');
const logger = require('./logger');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();

// Reference to the scheduled cron job so it can be restarted when the schedule
// changes.
let scheduledJob;

/**
 * Helper that (re)creates the cron job using the current expression stored in
 * config.cronSchedule.
 */
async function scheduleJob() {
  if (scheduledJob) scheduledJob.stop();
  scheduledJob = cron.schedule(config.cronSchedule, async () => {
    logger.info('Running scheduled scrape...');
    await scrape.run();
  });
}

// Load settings such as the cron schedule and any user-added sources from the
// database before the server begins handling requests. This ensures the in-memory
// configuration matches what was saved previously.
(async () => {
  try {
    const stored = await db.getCronSchedule();
    if (stored && cron.validate(stored)) {
      config.cronSchedule = stored;
    }

    // Load any persisted sources and merge them into the config object.
    const rows = await db.getSources();
    for (const row of rows) {
      config.sources[row.key] = {
        label: row.label,
        url: row.url,
        base: row.base,
        parser: row.parser
      };
    }
  } catch (err) {
    logger.error('Failed to load settings from DB:', err);
  }
  await scheduleJob();
})();

// Parse JSON request bodies so the UI can post new sources
app.use(express.json());
// Parse URL-encoded form bodies used by the login and registration forms
app.use(express.urlencoded({ extended: false }));
// Simple session middleware storing session data in memory. In production a
// persistent store should be used instead.
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change_this_secret',
    resave: false,
    saveUninitialized: false
  })
);

// Make the current user (if any) available to all templates
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  next();
});

// Middleware protecting admin routes by redirecting unauthenticated users
const requireAuth = (req, res, next) => {
  if (req.session.user) return next();
  res.redirect('/login');
};

// Configure EJS for HTML templates and serve static assets from the
// frontend directory defined in config.js
app.set('view engine', 'ejs');
app.set('views', config.frontendDir);
app.use(express.static(config.frontendDir));

// GET / - Render the dashboard listing all tenders stored in the database.
app.get('/', async (req, res) => {
  const tenders = await db.getTenders();
  // Pass the list of available sources to the frontend so it can populate the
  // new source selection dropdown.
  res.render('index', { tenders, sources: config.sources });
});

// GET /stats - Simple page showing the timestamp of the last successful scrape
// so users know how fresh the displayed data is.
app.get('/stats', async (req, res) => {
  const lastScraped = await db.getLastScraped();
  res.render('stats', { lastScraped });
});

// Authentication -----------------------------------------------------------

// Render login form
app.get('/login', (req, res) => {
  res.render('login');
});

// Handle login submissions
app.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = await db.getUserByUsername(username);
  // Validate credentials using bcrypt hash comparison
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).render('login', { error: 'Invalid credentials' });
  }
  // Persist minimal user info in the session
  req.session.user = { id: user.id, username: user.username };
  res.redirect('/admin');
});

// Render registration form
app.get('/register', (req, res) => {
  res.render('register');
});

// Handle account creation
app.post('/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).render('register', { error: 'Missing fields' });
  }
  if (await db.getUserByUsername(username)) {
    return res.status(400).render('register', { error: 'User already exists' });
  }
  // Hash the password so only the digest is stored
  const hash = await bcrypt.hash(password, 10);
  await db.createUser(username, hash);
  req.session.user = { username };
  res.redirect('/admin');
});

// Log the user out and destroy their session
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// POST /sources - Add a new scraping source at runtime. The request should
// include a unique key along with label, url and base properties. Sources are
// stored in memory so they persist only for the lifetime of the process.
// Persist new sources in the database so they remain available after a restart.
// The parser field defaults to "contractsFinder" since it matches our test HTML.
app.post('/sources', async (req, res) => {
  const { key, label, url, base, parser = 'contractsFinder' } = req.body || {};

  // Basic validation of the supplied data
  if (!key || !label || !url || !base) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (config.sources[key]) {
    return res.status(400).json({ error: 'Source key already exists' });
  }

  try {
    // Store the new source definition then add it to the in-memory object used
    // by the rest of the application.
    await db.insertSource(key, label, url, base, parser);
    config.sources[key] = { label, url, base, parser };
    logger.info(`Added new source ${key}: ${label}`);
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to persist source:', err);
    res.status(500).json({ error: 'Failed to save source' });
  }
});

// PUT /sources/:key - Update an existing scraping source. This mirrors the
// POST /sources handler but modifies an existing row instead of inserting a
// new one.
app.put('/sources/:key', async (req, res) => {
  const key = req.params.key;
  const { label, url, base, parser = 'contractsFinder' } = req.body || {};

  if (!config.sources[key]) {
    return res.status(404).json({ error: 'Source not found' });
  }
  if (!label || !url || !base) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    await db.updateSource(key, label, url, base, parser);
    config.sources[key] = { label, url, base, parser };
    logger.info(`Updated source ${key}: ${label}`);
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to update source:', err);
    res.status(500).json({ error: 'Failed to update source' });
  }
});

// DELETE /sources/:key - Remove a source entirely. The in-memory configuration
// is kept in sync so subsequent requests do not reference the deleted source.
app.delete('/sources/:key', async (req, res) => {
  const key = req.params.key;
  if (!config.sources[key]) {
    return res.status(404).json({ error: 'Source not found' });
  }
  try {
    await db.deleteSource(key);
    delete config.sources[key];
    logger.info(`Deleted source ${key}`);
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to delete source:', err);
    res.status(500).json({ error: 'Failed to delete source' });
  }
});

// GET /scrape - Trigger the scraper manually via an HTTP request. The route
// responds with the number of new tenders that were inserted.
app.get('/scrape', async (req, res) => {
  const sourceKey = req.query.source || 'default';
  const source = config.sources[sourceKey] || config.sources.default;
  logger.info(`Manual scrape triggered for ${sourceKey}`);
  const newTenders = await scrape.run(null, source);
  res.json({ added: newTenders });
});

// GET /scrape-all - Run the scraper against every configured source. This
// endpoint is used by the "Scrape All" button on the dashboard and simply
// returns a summary of how many tenders were added per source.
app.get('/scrape-all', async (req, res) => {
  logger.info('Manual scrape triggered for all sources');
  const results = await scrape.runAll();
  res.json(results);
});

// GET /scrape-stream - Same as /scrape but streams progress updates using
// Server-Sent Events so the frontend can display real-time feedback.
app.get('/scrape-stream', async (req, res) => {
  const sourceKey = req.query.source || 'default';
  const source = config.sources[sourceKey] || config.sources.default;
  logger.info(`Manual SSE scrape triggered for ${sourceKey}`);

  // Setup headers required for Server-Sent Events. `flushHeaders()` forces the
  // headers to be sent immediately so the connection remains open while we
  // stream data.
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();

  // Helper to send a data payload to the client as a single SSE message.
  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Run the scraper and stream progress for each tender found. The selected
  // source is forwarded to the scraper so different sites can be targeted.
  // Emit an initial event letting the client know which source will be used.
  send({ start: true, source: source.label, url: source.url });

  const count = await scrape.run(progress => send(progress), source);

  // Emit a final message indicating completion and close the connection.
  send({ done: true, added: count });
  res.end();
});

// GET /admin - Render the admin interface used for maintenance tasks.
app.get('/admin', requireAuth, (req, res) => {
  res.render('admin', { sources: config.sources, cron: config.cronSchedule });
});

// POST /admin/reset-db - Drop and recreate the tenders table. This allows the
// admin to clear out old data without restarting the server.
app.post('/admin/reset-db', requireAuth, async (req, res) => {
  try {
    await db.reset();
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to reset database:', err);
    res.status(500).json({ error: 'Reset failed' });
  }
});

// POST /admin/cron - Update the cron schedule at runtime. The existing job is
// stopped and a new one is created using the supplied expression.
app.post('/admin/cron', requireAuth, async (req, res) => {
  const schedule = req.body && req.body.schedule;
  if (!schedule || !cron.validate(schedule)) {
    return res.status(400).json({ error: 'Invalid schedule' });
  }
  try {
    await db.setCronSchedule(schedule);
    config.cronSchedule = schedule;
    await scheduleJob();
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to update cron schedule:', err);
    res.status(500).json({ error: 'Failed to update schedule' });
  }
});



// Start the HTTP server and log the URL so the user knows where to point
// their browser.
app.listen(config.port, () =>
  logger.info(`Server running on http://localhost:${config.port}`)
);
