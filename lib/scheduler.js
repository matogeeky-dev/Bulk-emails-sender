const { readDB, writeDB } = require('./db');
const { createDraft } = require('./imapDrafts');
const { renderTemplate, toHtml } = require('./template');

const SEND_DELAY_MS = Number(process.env.SEND_DELAY_MS || 60000);
const TICK_SECONDS = Number(process.env.SCHEDULER_INTERVAL_SECONDS || 60);

let running = false; // simple lock so ticks never overlap

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function draftBatch(account, campaign, accountEntry, batch) {
  const templates = campaign.templates;
  for (const recip of batch.recipients) {
    if (recip.status === 'drafted') continue; // already done (e.g. resumed after a crash)
    const tpl = templates[recip.templateIndex] || templates[0];
    const subject = renderTemplate(tpl.subject, recip);
    const bodyText = renderTemplate(tpl.body, recip);
    try {
      await createDraft(account, {
        to: recip.email,
        subject,
        html: toHtml(bodyText),
        text: bodyText
      });
      recip.status = 'drafted';
      recip.draftedAt = new Date().toISOString();
      recip.error = null;
    } catch (err) {
      recip.status = 'failed';
      recip.error = String(err && err.message ? err.message : err);
    }
    await sleep(SEND_DELAY_MS);
  }
  batch.status = 'drafted';
  batch.draftedAt = new Date().toISOString();
}

function campaignIsFullyDone(campaign) {
  return campaign.perAccount.every(a => a.batches.every(b => b.status === 'drafted'));
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
          if (batch.status === 'drafted') continue;
          const dueAt = startAt + batch.batchIndex * campaign.spacingHours * 3600 * 1000;
          if (now >= dueAt) {
            // eslint-disable-next-line no-await-in-loop
            await draftBatch(account, campaign, accountEntry, batch);
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
  console.log(`[scheduler] running every ${TICK_SECONDS}s, ${SEND_DELAY_MS}ms delay between drafts`);
  tick(); // run once on boot in case batches were already due
  setInterval(tick, TICK_SECONDS * 1000);
}

module.exports = { startScheduler, tick };
