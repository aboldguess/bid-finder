const express = require('express');
const db = require('./db');
const scrape = require('./scrape');
const cron = require('node-cron');
const config = require('./config');
const logger = require('./logger');

const app = express();
app.set('view engine', 'ejs');
// Use the configured path for templates and static assets
app.set('views', config.frontendDir);
app.use(express.static(config.frontendDir));

// Render the dashboard showing all stored tenders
app.get('/', async (req, res) => {
  const tenders = await db.getTenders();
  res.render('index', { tenders });
});

app.get('/scrape', async (req, res) => {
  logger.info('Manual scrape triggered');
  const newTenders = await scrape.run();
  res.json({ added: newTenders });
});

// Kick off the scraper based on the configured cron schedule
cron.schedule(config.cronSchedule, async () => {
  logger.info('Running scheduled scrape...');
  await scrape.run();
});

// Start the HTTP server
app.listen(config.port, () =>
  logger.info(`Server running on http://localhost:${config.port}`)
);
