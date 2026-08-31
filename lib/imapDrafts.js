const { ImapFlow } = require('imapflow');
const MailComposer = require('nodemailer/lib/mail-composer');

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

function buildRawMessage({ from, fromName, to, subject, html, text }) {
  return new Promise((resolve, reject) => {
    const composer = new MailComposer({
      from: `"${fromName}" <${from}>`,
      to,
      subject,
      html,
      text
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

async function verifyImapAccount(account) {
  const client = buildClient(account);
  await client.connect();
  await client.logout().catch(() => {});
  return true;
}

module.exports = { createDraft, verifyImapAccount };
