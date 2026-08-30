const { readDB, writeDB } = require('./db');
const { sendMail } = require('./mailer');
const { renderTemplate, toHtml } = require('./template');

const SEND_DELAY_MS = Number(process.env.SEND_DELAY_MS || 4000);
const TICK_SECONDS = Number(process.env.SCHEDULER_INTERVAL_SECONDS || 60);

let running = false; // simple lock so ticks never overlap

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendBatch(account, campaign, accountEntry, batch) {
  const templates = campaign.templates;
  for (const recip of batch.recipients) {
    if (recip.status === 'sent') continue; // already sent (e.g. resumed after a crash)
    const tpl = templates[recip.templateIndex] || templates[0];
    const subject = renderTemplate(tpl.subject, recip);
    const bodyText = renderTemplate(tpl.body, recip);
    try {
      await sendMail(account, {
        to: recip.email,
        subject,
        html: toHtml(bodyText),
        text: bodyText
      });
      recip.status = 'sent';
      recip.sentAt = new Date().toISOString();
      recip.error = null;
    } catch (err) {
      recip.status = 'failed';
      recip.error = String(err && err.message ? err.message : err);
    }
    await sleep(SEND_DELAY_MS);
  }
  batch.status = 'sent';
  batch.sentAt = new Date().toISOString();
}

function campaignIsFullyDone(campaign) {
  return campaign.perAccount.every(a => a.batches.every(b => b.status === 'sent'));
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const db = await readDB();
    const accountsById = Object.fromEntries(db.accounts.map(a => [a.id, a]));
    let dirty = false;

    for (const campaign of db.campaigns) {
      if (campaign.status !== 'running') continue;
      const now = Date.now();
      const startAt = new Date(campaign.startAt).getTime();

      for (const accountEntry of campaign.perAccount) {
        const account = accountsById[accountEntry.accountId];
        if (!account) continue;

        for (const batch of accountEntry.batches) {
          if (batch.status === 'sent') continue;
          const dueAt = startAt + batch.batchIndex * campaign.spacingHours * 3600 * 1000;
          if (now >= dueAt) {
            // eslint-disable-next-line no-await-in-loop
            await sendBatch(account, campaign, accountEntry, batch);
            dirty = true;
          }
        }
      }

      if (campaignIsFullyDone(campaign)) {
        campaign.status = 'completed';
        campaign.completedAt = new Date().toISOString();
        dirty = true;
      }
    }

    if (dirty) await writeDB(db);
  } catch (err) {
    console.error('[scheduler] tick failed:', err);
  } finally {
    running = false;
  }
}

function startScheduler() {
  console.log(`[scheduler] running every ${TICK_SECONDS}s, ${SEND_DELAY_MS}ms delay between messages`);
  tick(); // run once on boot in case batches were already due
  setInterval(tick, TICK_SECONDS * 1000);
}

module.exports = { startScheduler, tick };
