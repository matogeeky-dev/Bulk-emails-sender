const { ImapFlow } = require('imapflow');
const MailComposer = require('nodemailer/lib/mail-composer');

// Small pause between individual APPEND commands on the same connection.
// This isn't about avoiding a "sending" spam signal (drafts aren't sent) -
// it's just enough breathing room to avoid tripping a provider's generic
// command-rate abuse detection when writing hundreds of messages back to back.
const APPEND_DELAY_MS = Number(process.env.APPEND_DELAY_MS || 300);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// IMAP endpoints for the major providers all use port 993 with SSL, so we
// only need to ask the user for a host on custom domains.
function imapConfigFor(account) {
  if (account.provider === 'gmail') return { host: 'imap.gmail.com', port: 993, secure: true };
  if (account.provider === 'yahoo') return { host: 'imap.mail.yahoo.com', port: 993, secure: true };
  if (account.provider === 'outlook') return { host: 'outlook.office365.com', port: 993, secure: true };
  return { host: account.host, port: 993, secure: true }; // custom domain - reuses the "host" field
}

function buildClient(account) {
  const { host, port, secure } = imapConfigFor(account);
  if (!host) throw new Error('No IMAP host configured for this account');
  return new ImapFlow({
    host,
    port,
    secure,
    auth: { user: account.user, pass: account.pass },
    logger: false
  });
}

function buildRawMessage({ from, fromName, to, subject, html, text, attachments }) {
  return new Promise((resolve, reject) => {
    const composer = new MailComposer({
      from: `"${fromName}" <${from}>`,
      to,
      subject,
      html,
      text,
      attachments: attachments && attachments.length
        ? attachments.map(a => ({ filename: a.filename, content: a.content, contentType: a.contentType }))
        : undefined
    });
    composer.compile().build((err, message) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}

async function findDraftsMailbox(client) {
  const list = await client.list();
  const bySpecialUse = list.find(m => m.specialUse === '\\Drafts');
  if (bySpecialUse) return bySpecialUse.path;
  const byName = list.find(m => /draft/i.test(m.name));
  if (byName) return byName.path;
  throw new Error('Could not find a Drafts folder on this account');
}

// Creates one draft. Used by the "Create test draft" button - opens and
// closes its own connection since it's a single one-off action.
async function createDraft(account, { to, subject, html, text }) {
  const client = buildClient(account);
  await client.connect();
  try {
    const mailboxPath = await findDraftsMailbox(client);
    const raw = await buildRawMessage({
      from: account.user,
      fromName: account.fromName || account.label || account.user,
      to,
      subject,
      html,
      text
    });
    await client.append(mailboxPath, raw, ['\\Draft']);
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Creates many drafts for one account over a single reused IMAP connection.
 * `messages` is an array of { to, subject, html, text, ref } where `ref` is
 * any value the caller wants back to identify which recipient succeeded or
 * failed (e.g. an index into the campaign's recipient list).
 * Returns an array of { ref, ok, error } in the same order as `messages`.
 * A connection failure at the start fails every message the same way,
 * rather than throwing and losing partial progress.
 */
async function createDraftsBatch(account, messages) {
  const results = [];
  const client = buildClient(account);
  try {
    await client.connect();
  } catch (err) {
    const message = String(err.message || err);
    return messages.map(m => ({ ref: m.ref, ok: false, error: message }));
  }

  try {
    const mailboxPath = await findDraftsMailbox(client);
    for (const m of messages) {
      try {
        const raw = await buildRawMessage({
          from: account.user,
          fromName: account.fromName || account.label || account.user,
          to: m.to,
          subject: m.subject,
          html: m.html,
          text: m.text,
          attachments: m.attachments
        });
        await client.append(mailboxPath, raw, ['\\Draft']);
        results.push({ ref: m.ref, ok: true });
      } catch (err) {
        results.push({ ref: m.ref, ok: false, error: String(err.message || err) });
      }
      if (APPEND_DELAY_MS > 0) await sleep(APPEND_DELAY_MS);
    }
  } catch (err) {
    // Couldn't even find the Drafts folder - everything not yet attempted fails the same way.
    const message = String(err.message || err);
    const doneRefs = new Set(results.map(r => r.ref));
    for (const m of messages) {
      if (!doneRefs.has(m.ref)) results.push({ ref: m.ref, ok: false, error: message });
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return results;
}

async function verifyImapAccount(account) {
  const client = buildClient(account);
  await client.connect();
  await client.logout().catch(() => {});
  return true;
}

module.exports = { createDraft, createDraftsBatch, verifyImapAccount };
