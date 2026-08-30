const express = require('express');
const router = express.Router();
const { readDB, writeDB, nextId } = require('../lib/db');
const { verifyAccount, sendMail } = require('../lib/mailer');

function publicAccount(a) {
  const { pass, ...rest } = a;
  return { ...rest, hasPassword: !!pass };
}

router.get('/', async (req, res) => {
  const db = await readDB();
  res.json(db.accounts.map(publicAccount));
});

router.post('/', async (req, res) => {
  const { label, provider, user, pass, host, port, secure, fromName } = req.body;
  if (!user || !pass || !provider) {
    return res.status(400).json({ error: 'provider, user and pass are required' });
  }
  if (provider === 'custom' && !host) {
    return res.status(400).json({ error: 'host is required for custom domain mail' });
  }
  const db = await readDB();
  const account = {
    id: nextId(db, 'account'),
    label: label || user,
    provider,
    user,
    pass,
    host: host || null,
    port: port || (secure ? 465 : 587),
    secure: !!secure,
    fromName: fromName || label || user,
    createdAt: new Date().toISOString()
  };
  db.accounts.push(account);
  await writeDB(db);
  res.status(201).json(publicAccount(account));
});

router.delete('/:id', async (req, res) => {
  const db = await readDB();
  const id = Number(req.params.id);
  db.accounts = db.accounts.filter(a => a.id !== id);
  await writeDB(db);
  res.json({ ok: true });
});

// Verifies SMTP credentials without sending anything
router.post('/:id/verify', async (req, res) => {
  const db = await readDB();
  const account = db.accounts.find(a => a.id === Number(req.params.id));
  if (!account) return res.status(404).json({ error: 'account not found' });
  try {
    await verifyAccount(account);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[verify] account ${account.id} (${account.user}) failed:`, err.message || err);
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
});

// Sends a real test email to the account itself
router.post('/:id/test-send', async (req, res) => {
  const db = await readDB();
  const account = db.accounts.find(a => a.id === Number(req.params.id));
  if (!account) return res.status(404).json({ error: 'account not found' });
  try {
    await sendMail(account, {
      to: account.user,
      subject: 'Test email from Bulk Email Sender',
      html: 'This is a test message confirming this account can send.',
      text: 'This is a test message confirming this account can send.'
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(`[test-send] account ${account.id} (${account.user}) failed:`, err.message || err);
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
});

module.exports = router;
