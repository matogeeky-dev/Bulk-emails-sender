const { readDB, writeDB } = require('./db');
const { createDraftsBatch } = require('./imapDrafts');
const { renderTemplate, toHtml } = require('./template');

const TICK_SECONDS = Number(process.env.SCHEDULER_INTERVAL_SECONDS || 20);

let running = false; // simple lock so ticks never overlap

function campaignIsFullyDone(campaign) {
  return campaign.perAccount.every(a => a.batches.every(b => b.status === 'drafted'));
}

// Runs one account's whole batch as fast as the IMAP server allows, over a
// single reused connection. Returns nothing - mutates the batch in place.
async function draftAccountBatch(account, campaign, batch) {
  const templates = campaign.templates;
  const toDraft = batch.recipients
    .map((recip, idx) => ({ recip, idx }))
    .filter(({ recip }) => recip.status !== 'drafted');

  const messages = toDraft.map(({ recip, idx }) => {
    const tpl = templates[recip.templateIndex] || templates[0];
    const subject = renderTemplate(tpl.subject, recip);
    const bodyText = renderTemplate(tpl.body, recip);
    return { ref: idx, to: recip.email, subject, html: toHtml(bodyText), text: bodyText };
  });

  const results = await createDraftsBatch(account, messages);
  for (const r of results) {
    const recip = batch.recipients[r.ref];
    if (r.ok) {
      recip.status = 'drafted';
      recip.draftedAt = new Date().toISOString();
      recip.error = null;
    } else {
      recip.status = 'failed';
      recip.error = r.error;
    }
  }
  batch.status = 'drafted';
  batch.draftedAt = new Date().toISOString();
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
      if (now < startAt) continue; // not due yet (scheduled start time in the future)

      // Gather every account's pending batch and run them all in parallel -
      // there's no reason to wait between accounts, or between recipients
      // within an account beyond the small per-message pause in imapDrafts.
      const jobs = [];
      for (const accountEntry of campaign.perAccount) {
        const account = accountsById[accountEntry.accountId];
        if (!account) continue;
        for (const batch of accountEntry.batches) {
          if (batch.status === 'drafted') continue;
          jobs.push(draftAccountBatch(account, campaign, batch));
        }
      }

      if (jobs.length) {
        await Promise.allSettled(jobs);
        dirty = true;
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
  console.log(`[scheduler] running every ${TICK_SECONDS}s`);
  tick(); // run once on boot in case a campaign was already due
  setInterval(tick, TICK_SECONDS * 1000);
}

module.exports = { startScheduler, tick };
