const express = require('express');
const db = require('./db');
const scrape = require('./scrape');
const cron = require('node-cron');
const config = require('./config');
const logger = require('./logger');

const app = express();

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

// GET /scrape - Trigger the scraper manually via an HTTP request. The route
// responds with the number of new tenders that were inserted.
app.get('/scrape', async (req, res) => {
  const sourceKey = req.query.source || 'default';
  const source = config.sources[sourceKey] || config.sources.default;
  logger.info(`Manual scrape triggered for ${sourceKey}`);
  const newTenders = await scrape.run(null, source);
  res.json({ added: newTenders });
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

// Schedule automatic scraping based on the CRON_SCHEDULE environment
// variable. By default this runs once per day at 06:00.
cron.schedule(config.cronSchedule, async () => {
  logger.info('Running scheduled scrape...');
  await scrape.run();
});

// Start the HTTP server and log the URL so the user knows where to point
// their browser.
app.listen(config.port, () =>
  logger.info(`Server running on http://localhost:${config.port}`)
);
