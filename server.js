require('dotenv').config();
const express = require('express');
const path = require('path');
const { startScheduler } = require('./lib/scheduler');

const app = express();
app.use(express.json({ limit: '10mb' })); // recipient CSVs can be sizeable once parsed to JSON

// --- very small basic-auth gate so this isn't wide open on the public internet ---
const APP_USERNAME = process.env.APP_USERNAME || 'admin';
const APP_PASSWORD = process.env.APP_PASSWORD || 'change-this-password';

app.use((req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const [user, pass] = decoded.split(':');
    if (user === APP_USERNAME && pass === APP_PASSWORD) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Bulk Email Sender"');
  res.status(401).send('Authentication required');
});
// --- end auth gate ---

app.use('/api/accounts', require('./routes/accounts'));
app.use('/api/campaigns', require('./routes/campaigns'));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bulk Email Sender listening on port ${PORT}`);
  startScheduler();
});
