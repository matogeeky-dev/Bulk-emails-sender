const BATCH_SIZE = 10;

/**
 * accountsConfig: [{ accountId, sendCount }]
 * recipients: [{ name, email }]
 * templatesCount: number of uploaded email copies (for rotation)
 *
 * Recipients are sliced sequentially across accounts in the order accounts
 * were selected: account 1 gets its first `sendCount` recipients, account 2
 * gets the next `sendCount`, and so on. If there aren't enough recipients to
 * cover every account's sendCount, the recipient list is cycled back to the
 * start (so nothing goes unsent, but the same contact may be reused).
 *
 * Each account's recipients are then chunked into batches of up to 10, and
 * every recipient in every batch gets a templateIndex assigned by rotating
 * 0..templatesCount-1 continuously across ALL of that account's batches
 * (not reset per batch), matching: copy1, copy2, ... copyN, copy1, copy2 ...
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
    const batches = [];
    for (let i = 0; i < assigned.length; i += BATCH_SIZE) {
      const slice = assigned.slice(i, i + BATCH_SIZE);
      const batchIndex = Math.floor(i / BATCH_SIZE);
      const batchRecipients = slice.map((r, idxInSlice) => {
        const globalIdx = i + idxInSlice; // continuous counter across all batches for this account
        return {
          name: r.name || '',
          email: r.email,
          templateIndex: globalIdx % templatesCount,
          status: 'pending', // pending | sent | failed
          error: null,
          sentAt: null
        };
      });
      batches.push({
        batchIndex,
        status: 'pending', // pending | sent
        recipients: batchRecipients
      });
    }
    return {
      accountId: cfg.accountId,
      sendCount: cfg.sendCount,
      batches
    };
  });

  const maxBatches = Math.max(...perAccount.map(a => a.batches.length));
  return { perAccount, maxBatches };
}

module.exports = { buildAccountBatches, BATCH_SIZE };
