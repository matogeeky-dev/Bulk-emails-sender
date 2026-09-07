const fs = require('fs');
const path = require('path');
const { readDB, writeDB, getAttachment } = require('./db');
const { createDraftsBatch } = require('./imapDrafts');
const { renderTemplate, toHtml } = require('./template');

const TICK_SECONDS = Number(process.env.SCHEDULER_INTERVAL_SECONDS || 20);
const ZIPS_DIR = path.join(__dirname, '..', 'data', 'image-zips');

let running = false; // simple lock so ticks never overlap

function campaignIsFullyDone(campaign) {
  return campaign.perAccount.every(a => a.batches.every(b => b.status === 'drafted'));
}

// Attachments are shared across every recipient using a given template
// copy, so resolve each one's actual bytes once per campaign per tick -
// not once per account or per recipient - to avoid redundant reads.
async function resolveTemplateAttachments(templates) {
  return Promise.all(
    templates.map(async tpl => {
      if (!tpl.attachments || !tpl.attachments.length) return [];
      const resolved = await Promise.all(
        tpl.attachments.map(async a => {
          const att = await getAttachment(a.id);
          if (!att) return null; // silently skip a deleted/missing attachment rather than fail the whole draft
          return { filename: att.filename, contentType: att.contentType, content: Buffer.from(att.dataBase64, 'base64') };
        })
      );
      return resolved.filter(Boolean);
    })
  );
}

// A recipient's personalized image (matched by name from an uploaded zip)
// lives on local disk, not in the DB - read it fresh per recipient rather
// than preloading thousands of images into memory at once.
function loadPersonalizedImage(recip) {
  if (!recip.imagePath) return null;
  try {
    return { filename: path.basename(recip.imagePath), content: fs.readFileSync(recip.imagePath) };
  } catch (err) {
    console.error(`[scheduler] could not read personalized image for ${recip.email}:`, err.message || err);
    return null; // draft still goes out, just without the image
  }
}

// Runs one account's whole batch as fast as the IMAP server allows, over a
// single reused connection. Returns nothing - mutates the batch in place.
async function draftAccountBatch(account, campaign, batch, templateAttachments) {
  const templates = campaign.templates;
  const toDraft = batch.recipients
    .map((recip, idx) => ({ recip, idx }))
    .filter(({ recip }) => recip.status !== 'drafted');

  const messages = toDraft.map(({ recip, idx }) => {
    const tpl = templates[recip.templateIndex] || templates[0];
    const subject = renderTemplate(tpl.subject, recip);
    const bodyText = renderTemplate(tpl.body, recip);
    const personalizedImage = loadPersonalizedImage(recip);
    const attachments = [...(templateAttachments[recip.templateIndex] || [])];
    if (personalizedImage) attachments.push(personalizedImage);
    return {
      ref: idx,
      to: recip.email,
      subject,
      html: toHtml(bodyText),
      text: bodyText,
      attachments
    };
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

function cleanupCampaignImages(campaign) {
  if (!campaign.imageZipUploadId) return;
  const dir = path.join(ZIPS_DIR, campaign.imageZipUploadId);
  fs.rm(dir, { recursive: true, force: true }, err => {
    if (err) console.error(`[scheduler] failed to clean up images for campaign ${campaign.id}:`, err.message || err);
  });
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
      const pendingBatches = [];
      for (const accountEntry of campaign.perAccount) {
        const account = accountsById[accountEntry.accountId];
        if (!account) continue;
        for (const batch of accountEntry.batches) {
          if (batch.status === 'drafted') continue;
          pendingBatches.push({ account, batch });
        }
      }

      if (pendingBatches.length) {
        const templateAttachments = await resolveTemplateAttachments(campaign.templates);
        await Promise.allSettled(
          pendingBatches.map(({ account, batch }) => draftAccountBatch(account, campaign, batch, templateAttachments))
        );
        dirty = true;
      }

      if (campaignIsFullyDone(campaign)) {
        campaign.status = 'completed';
        campaign.completedAt = new Date().toISOString();
        cleanupCampaignImages(campaign); // images are already embedded in the created drafts, safe to remove now
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
