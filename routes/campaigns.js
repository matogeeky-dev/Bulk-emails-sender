const express = require('express');
const router = express.Router();
const { readDB, writeDB, nextId } = require('../lib/db');
const { buildAccountBatches, BATCH_SIZE } = require('../lib/campaignBuilder');

function summarize(campaign) {
  let total = 0, sent = 0, failed = 0, pending = 0;
  for (const acc of campaign.perAccount) {
    for (const b of acc.batches) {
      for (const r of b.recipients) {
        total++;
        if (r.status === 'sent') sent++;
        else if (r.status === 'failed') failed++;
        else pending++;
      }
    }
  }
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    createdAt: campaign.createdAt,
    startAt: campaign.startAt,
    spacingHours: campaign.spacingHours,
    accountsUsed: campaign.perAccount.length,
    templatesUsed: campaign.templates.length,
    totals: { total, sent, failed, pending }
  };
}

router.get('/', (req, res) => {
  const db = readDB();
  res.json(db.campaigns.map(summarize).sort((a, b) => b.id - a.id));
});

router.get('/:id', (req, res) => {
  const db = readDB();
  const campaign = db.campaigns.find(c => c.id === Number(req.params.id));
  if (!campaign) return res.status(404).json({ error: 'not found' });
  const accountLabels = Object.fromEntries(db.accounts.map(a => [a.id, a.label]));
  res.json({
    ...campaign,
    perAccount: campaign.perAccount.map(a => ({ ...a, accountLabel: accountLabels[a.accountId] || `#${a.accountId}` }))
  });
});

router.post('/', async (req, res) => {
  try {
    const { name, accounts, spacingHours, templates, recipients, startAt } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!Array.isArray(accounts) || !accounts.length) return res.status(400).json({ error: 'select at least one account' });
    if (!Array.isArray(templates) || !templates.length) return res.status(400).json({ error: 'upload at least one email copy' });
    if (!Array.isArray(recipients) || !recipients.length) return res.status(400).json({ error: 'upload a recipient CSV' });
    if (!spacingHours || spacingHours <= 0) return res.status(400).json({ error: 'spacingHours must be greater than 0' });

    const db = readDB();
    const validAccountIds = new Set(db.accounts.map(a => a.id));
    for (const a of accounts) {
      if (!validAccountIds.has(a.accountId)) return res.status(400).json({ error: `unknown account id ${a.accountId}` });
      if (!a.sendCount || a.sendCount <= 0) return res.status(400).json({ error: 'each account needs a sendCount greater than 0' });
      if (a.sendCount > 100) return res.status(400).json({ error: 'sendCount cannot exceed 100 per account' });
    }
    if (accounts.length > 60) return res.status(400).json({ error: 'maximum 60 accounts per campaign' });

    const cleanRecipients = recipients
      .map(r => ({ name: (r.name || '').trim(), email: (r.email || '').trim() }))
      .filter(r => r.email);

    const { perAccount, maxBatches } = buildAccountBatches(accounts, cleanRecipients, templates.length);

    const campaign = {
      id: nextId(db, 'campaign'),
      name,
      status: 'running',
      createdAt: new Date().toISOString(),
      startAt: startAt ? new Date(startAt).toISOString() : new Date().toISOString(),
      spacingHours: Number(spacingHours),
      batchSize: BATCH_SIZE,
      templates: templates.map(t => ({ subject: t.subject || '(no subject)', body: t.body || '' })),
      recipientCount: cleanRecipients.length,
      maxBatches,
      perAccount
    };

    db.campaigns.push(campaign);
    await writeDB(db);
    res.status(201).json(summarize(campaign));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.patch('/:id', async (req, res) => {
  const db = readDB();
  const campaign = db.campaigns.find(c => c.id === Number(req.params.id));
  if (!campaign) return res.status(404).json({ error: 'not found' });
  const { status } = req.body;
  if (!['running', 'paused', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'status must be running, paused or cancelled' });
  }
  campaign.status = status;
  await writeDB(db);
  res.json(summarize(campaign));
});

module.exports = router;
