const nodemailer = require('nodemailer');

function buildTransportConfig(account) {
  if (account.provider === 'gmail') {
    return { service: 'gmail', auth: { user: account.user, pass: account.pass } };
  }
  if (account.provider === 'yahoo') {
    return { service: 'yahoo', auth: { user: account.user, pass: account.pass } };
  }
  if (account.provider === 'outlook') {
    return { service: 'hotmail', auth: { user: account.user, pass: account.pass } };
  }
  // custom domain mail - use explicit SMTP settings
  return {
    host: account.host,
    port: Number(account.port) || 587,
    secure: !!account.secure, // true for 465, false for other ports
    auth: { user: account.user, pass: account.pass }
  };
}

function createTransport(account) {
  return nodemailer.createTransport(buildTransportConfig(account));
}

async function verifyAccount(account) {
  const transporter = createTransport(account);
  await transporter.verify();
  return true;
}

async function sendMail(account, { to, subject, html, text }) {
  const transporter = createTransport(account);
  const fromName = account.fromName || account.label || account.user;
  const info = await transporter.sendMail({
    from: `"${fromName}" <${account.user}>`,
    to,
    subject,
    html,
    text
  });
  return info;
}

module.exports = { createTransport, verifyAccount, sendMail };
