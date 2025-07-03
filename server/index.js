const express = require('express');
const db = require('./db');
const scrape = require('./scrape');
const scrapeAwarded = require('./scrapeAwarded');
const cron = require('node-cron');
const config = require('./config');
const logger = require('./logger');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fetch = require('node-fetch');
const { parseTenders } = require('./htmlParser');

const app = express();
// Store per-source status strings for display on the scraper screen. Keys
// correspond to source identifiers with values like "ok" or an error message.
const sourceStatus = {};

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

    // Load any stored award source definitions so the awards scraper can use
    // custom entries defined via the admin UI.
    const awardRows = await db.getAwardSources();
    for (const row of awardRows) {
      config.awardSources[row.key] = {
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
    saveUninitialized: false,
    // Persist the session cookie for 30 days so users remain logged in
    // even after closing the browser. The in-memory store still means
    // sessions are lost if the server restarts.
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
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

// GET / - Redirect to the dashboard page which summarises scraping activity.
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// Render the dashboard showing log output and overall source status.
app.get('/dashboard', async (req, res) => {
  const statsRows = await db.getSourceStats();
  const stats = {};
  for (const row of statsRows) {
    stats[row.key] = row;
  }
  // Gather basic totals so the dashboard can report how many records exist.
  const tenderCount = await db.getTenderCount();
  const awardCount = await db.getAwardCount();
  const customerCount = await db.getOrganisationCount('customer');
  const supplierCount = await db.getOrganisationCount('supplier');
  res.render('dashboard', {
    sources: config.sources,
    sourceStatus,
    counts: {
      tenders: tenderCount,
      awards: awardCount,
      customers: customerCount,
      suppliers: supplierCount
    },
    page: 'dashboard'
  });
});

// GET /opportunities - Render the table of currently available tenders.
app.get('/opportunities', async (req, res) => {
  const tenders = await db.getTenders();
  res.render('opportunities', {
    tenders,
    sources: config.sources,
    page: 'opportunities'
  });
});

// GET /awarded - Display contracts that have been awarded using the separate
// awards scraper.
app.get('/awarded', async (req, res) => {
  const tenders = await db.getAwards();
  res.render('awarded', {
    tenders,
    sources: config.awardSources,
    page: 'awarded'
  });
});

// GET /scraper - Display all configured sources along with stats and actions
// for testing or scraping them individually.
app.get('/scraper', async (req, res) => {
  const statsRows = await db.getSourceStats();
  const stats = {};
  for (const row of statsRows) {
    stats[row.key] = row;
  }
  res.render('scraper', {
    sources: config.sources,
    sourceStats: stats,
    sourceStatus,
    page: 'scraper'
  });
});

// GET /stats - Simple page showing the timestamp of the last successful scrape
// so users know how fresh the displayed data is.
app.get('/stats', async (req, res) => {
  const lastScraped = await db.getLastScraped();
  // Retrieve per-source statistics so the UI can show detailed
  // information for debugging purposes.
  const statsRows = await db.getSourceStats();
  // Convert the list of rows into an object keyed by source for easier lookups
  // in the template.
  const stats = {};
  for (const row of statsRows) {
    stats[row.key] = row;
  }
  res.render('stats', {
    lastScraped,
    // Provide the list of sources so labels can be shown alongside stats.
    sources: config.sources,
    sourceStats: stats,
    page: 'stats'
  });
});

// Lists of organisations scraped from tender sources
app.get('/customers', async (req, res) => {
  const organisations = await db.getOrganisationsByType('customer');
  res.render('customers', { organisations, page: 'crm' });
});

app.get('/suppliers', async (req, res) => {
  const organisations = await db.getOrganisationsByType('supplier');
  res.render('suppliers', { organisations, page: 'crm' });
});

// CRM page combining customers and suppliers for easier browsing.
app.get('/crm', async (req, res) => {
  const customers = await db.getOrganisationsByType('customer');
  const suppliers = await db.getOrganisationsByType('supplier');
  res.render('crm', { customers, suppliers, page: 'crm' });
});

// Authentication -----------------------------------------------------------

// Render login form
app.get('/login', (req, res) => {
  res.render('login', { page: 'login' });
});

// Handle login submissions
app.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = await db.getUserByUsername(username);
  // Validate credentials using bcrypt hash comparison
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res
      .status(401)
      .render('login', { error: 'Invalid credentials', page: 'login' });
  }
  // Persist minimal user info in the session
  req.session.user = { id: user.id, username: user.username };
  res.redirect('/admin');
});

// Render registration form
app.get('/register', (req, res) => {
  res.render('register', { page: 'login' });
});

// Handle account creation
app.post('/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res
      .status(400)
      .render('register', { error: 'Missing fields', page: 'login' });
  }
  if (await db.getUserByUsername(username)) {
    return res
      .status(400)
      .render('register', { error: 'User already exists', page: 'login' });
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

// -------- Award Source Management -----------------------------------------

// POST /award-sources - Add a new award scraping source.
app.post('/award-sources', async (req, res) => {
  const { key, label, url, base, parser = 'contractsFinder' } = req.body || {};

  if (!key || !label || !url || !base) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (config.awardSources[key]) {
    return res.status(400).json({ error: 'Source key already exists' });
  }

  try {
    await db.insertAwardSource(key, label, url, base, parser);
    config.awardSources[key] = { label, url, base, parser };
    logger.info(`Added new award source ${key}: ${label}`);
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to save award source:', err);
    res.status(500).json({ error: 'Failed to save source' });
  }
});

// PUT /award-sources/:key - Update an existing award source.
app.put('/award-sources/:key', async (req, res) => {
  const key = req.params.key;
  const { label, url, base, parser = 'contractsFinder' } = req.body || {};

  if (!config.awardSources[key]) {
    return res.status(404).json({ error: 'Source not found' });
  }
  if (!label || !url || !base) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    await db.updateAwardSource(key, label, url, base, parser);
    config.awardSources[key] = { label, url, base, parser };
    logger.info(`Updated award source ${key}: ${label}`);
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to update award source:', err);
    res.status(500).json({ error: 'Failed to update source' });
  }
});

// DELETE /award-sources/:key - Remove an award source completely.
app.delete('/award-sources/:key', async (req, res) => {
  const key = req.params.key;
  if (!config.awardSources[key]) {
    return res.status(404).json({ error: 'Source not found' });
  }
  try {
    await db.deleteAwardSource(key);
    delete config.awardSources[key];
    logger.info(`Deleted award source ${key}`);
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to delete award source:', err);
    res.status(500).json({ error: 'Failed to delete source' });
  }
});

// GET /test-source - Fetch the first page of a source to check availability.
// The response simply reports whether the request succeeded and how many
// tenders were parsed from that single page.
app.get('/test-source', async (req, res) => {
  const key = req.query.key;
  const src = config.sources[key];
  if (!src) return res.status(404).json({ error: 'Source not found' });
  try {
    const r = await fetch(src.url);
    const html = await r.text();
    const tenders = parseTenders(html, src.parser);
    sourceStatus[key] = 'ok';
    res.json({ status: 'ok', count: tenders.length });
  } catch (err) {
    sourceStatus[key] = 'error';
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /scrape - Trigger the scraper manually via an HTTP request. The route
// responds with the number of new tenders that were inserted.
app.get('/scrape', async (req, res) => {
  const sourceKey = req.query.source || 'default';
  const source = config.sources[sourceKey] || config.sources.default;
  logger.info(`Manual scrape triggered for ${sourceKey}`);
  const newTenders = await scrape.run(null, source, sourceKey);
  res.json({ added: newTenders });
});

// Trigger the awards scraper for a specific source.
app.get('/scrape-awarded', async (req, res) => {
  const sourceKey = req.query.source || 'default';
  const source = config.awardSources[sourceKey] || config.awardSources.default;
  logger.info(`Manual awards scrape triggered for ${sourceKey}`);
  const added = await scrapeAwarded.run(null, source, sourceKey);
  res.json({ added });
});

// GET /scrape-all - Run the scraper against every configured source. This
// endpoint is used by the "Scrape All" button on the dashboard and simply
// returns a summary of how many tenders were added per source.
app.get('/scrape-all', async (req, res) => {
  logger.info('Manual scrape triggered for all sources');
  const results = await scrape.runAll();
  res.json(results);
});

// Scrape all award sources sequentially and return per-source stats.
app.get('/scrape-awarded-all', async (req, res) => {
  logger.info('Manual awards scrape triggered for all sources');
  const results = await scrapeAwarded.runAll();
  res.json(results);
});

// SSE endpoint that streams progress while scraping every source sequentially.
app.get('/scrape-all-stream', async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();

  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const results = await scrape.runAll(p => send(p));
  send({ done: true, results });
  res.end();
});

// GET /scrape-stream - Same as /scrape but streams progress updates using
// Server-Sent Events so the frontend can display real-time feedback.
app.get('/scrape-stream', async (req, res) => {
  const sourceKey = req.query.source || 'default';
  const source = config.sources[sourceKey] || config.sources.default;
  logger.info(`Manual SSE scrape triggered for ${sourceKey}`);

  // Record the start time so the total duration can be reported at the end.
  const start = Date.now();

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
  const count = await scrape.run(progress => send(progress), source, sourceKey);

  // Emit a final message indicating completion and close the connection.
  send({
    done: true,
    added: count,
    duration: Math.round((Date.now() - start) / 1000)
  });
  res.end();
});

// SSE streaming variant of the awards scraper.
app.get('/scrape-awarded-stream', async (req, res) => {
  const sourceKey = req.query.source || 'default';
  const source = config.awardSources[sourceKey] || config.awardSources.default;
  logger.info(`Manual SSE awards scrape triggered for ${sourceKey}`);

  const start = Date.now();

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();

  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const count = await scrapeAwarded.run(progress => send(progress), source, sourceKey);
  send({
    done: true,
    added: count,
    duration: Math.round((Date.now() - start) / 1000)
  });
  res.end();
});

// Stream log entries to the dashboard so progress can be monitored live.
app.get('/logs', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();

  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const listener = log => send(log);
  logger.emitter.on('log', listener);

  req.on('close', () => logger.emitter.off('log', listener));
});

// GET /admin - Render the admin interface used for maintenance tasks.
// Fetch scraping statistics and render the admin page.
app.get('/admin', requireAuth, async (req, res) => {
  const statsRows = await db.getSourceStats();
  const stats = {};
  for (const row of statsRows) {
    stats[row.key] = row;
  }
  res.render('admin', {
    sources: config.sources,
    awardSources: config.awardSources,
    cron: config.cronSchedule,
    sourceStats: stats,
    page: 'admin'
  });
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

// Remove every tender from the database. Authentication is required so only
// authorised users can perform destructive actions.
app.post('/admin/delete-all', requireAuth, async (req, res) => {
  try {
    await db.deleteAllTenders();
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to delete all tenders:', err);
    res.status(500).json({ error: 'Failed to delete data' });
  }
});

// Delete tenders older than the supplied date.
app.post('/admin/delete-before', requireAuth, async (req, res) => {
  const date = req.body && req.body.date;
  if (!date) return res.status(400).json({ error: 'Missing date' });
  try {
    await db.deleteTendersBefore(date);
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to delete old tenders:', err);
    res.status(500).json({ error: 'Failed to delete data' });
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
// their browser. Binding to config.host allows access from other machines when
// the host is set to 0.0.0.0.
app.listen(config.port, config.host, () => {
  // Display a helpful startup message indicating how the server can be
  // reached. When binding to 0.0.0.0 there is no single address clients should
  // use, so list all non-internal IPv4 interfaces as suggestions.
  if (config.host === '0.0.0.0') {
    const os = require('os');
    const nets = os.networkInterfaces();
    const addresses = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        // Skip over internal (e.g. loopback) and non-IPv4 addresses.
        if (net.family === 'IPv4' && !net.internal) {
          addresses.push(`http://${net.address}:${config.port}`);
        }
      }
    }
    const urls = addresses.join(', ') || `http://localhost:${config.port}`;
    logger.info(`Server running on ${urls}`);
  } else {
    logger.info(`Server running on http://${config.host}:${config.port}`);
  }
});
