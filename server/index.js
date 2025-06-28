const express = require('express');
const path = require('path');
const db = require('./db');
const scrape = require('./scrape');
const cron = require('node-cron');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../frontend'));
app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/', async (req, res) => {
  const tenders = await db.getTenders();
  res.render('index', { tenders });
});

app.get('/scrape', async (req, res) => {
  const newTenders = await scrape.run();
  res.json({ added: newTenders });
});

cron.schedule('0 6 * * *', async () => {
  console.log('Running daily scrape...');
  await scrape.run();
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
