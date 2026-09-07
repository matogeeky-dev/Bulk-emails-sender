/**
 * accountsConfig: [{ accountId, sendCount }]
 * recipients: [{ name, email }]
 * templatesCount: number of uploaded email copies (for rotation)
 *
 * Recipients are sliced sequentially across accounts in the order accounts
 * were selected: account 1 gets its first `sendCount` recipients, account 2
 * gets the next `sendCount`, and so on. If there aren't enough recipients to
 * cover every account's sendCount, the recipient list is cycled back to the
 * start (so nothing goes undrafted, but the same contact may be reused).
 *
 * Each account gets a single batch holding all of its assigned recipients -
 * drafts aren't sent, so there's no reason to space them out. Every
 * recipient gets a templateIndex assigned by rotating 0..templatesCount-1
 * in order, matching: copy1, copy2, ... copyN, copy1, copy2 ...
 */
function buildAccountBatches(accountsConfig, recipients, templatesCount) {
  if (!recipients.length) throw new Error('No recipients provided');
  if (!templatesCount) throw new Error('No email copies provided');

  let cursor = 0;
  const pullRecipients = (count) => {
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push(recipients[cursor % recipients.length]);
      cursor++;
    }
    return out;
  };

  const perAccount = accountsConfig.map(cfg => {
    const assigned = pullRecipients(cfg.sendCount);
    const batchRecipients = assigned.map((r, idx) => ({
      name: r.name || '',
      email: r.email,
      templateIndex: idx % templatesCount,
      status: 'pending', // pending | drafted | failed
      error: null,
      draftedAt: null
    }));
    return {
      accountId: cfg.accountId,
      sendCount: cfg.sendCount,
      batches: [{
        batchIndex: 0,
        status: 'pending', // pending | drafted
        recipients: batchRecipients
      }]
    };
  });

  return { perAccount, maxBatches: 1 };
}

module.exports = { buildAccountBatches };
