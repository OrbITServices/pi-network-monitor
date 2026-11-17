require('dotenv').config();

const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const db = require('./services/db');
const monitor = require('./services/monitor');

const app = express();
const PORT = process.env.PORT || 3000;

db.init();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', require('./routes/main'));
app.use('/devices', require('./routes/devices'));
app.use('/alerts', require('./routes/alerts'));
app.use('/settings', require('./routes/settings'));

app.get('/health', (req, res) => {
  res.json({ ok: true, app: process.env.APP_NAME || 'Pi Network Monitor', version: '1.0.0' });
});

monitor.start();
require('./services/wordpress-reporting').start();

app.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log(`${process.env.APP_NAME || 'Pi Network Monitor'} running on port ${PORT}`);
});
