const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  accounts: [],
  recipients: [],
  templates: [{ subject: '', body: '', attachments: [] }], // start with one empty copy
};

// ---------- nav ----------
function showView(name) {
  $$('.view').forEach(v => v.hidden = true);
  $(`#view-${name}`).hidden = false;
  $$('.nav-item').forEach(b => b.classList.toggle('is-active', b.dataset.view === name));
  if (name === 'campaigns') { loadCampaigns(); closeCampaignDetail(); }
  if (name === 'new') renderAccountPicker();
}
$$('.nav-item').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));

// ---------- API helper ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ================= ACCOUNTS =================
async function loadAccounts() {
  state.accounts = await api('/api/accounts');
  renderAccountsTable();
}

function renderAccountsTable() {
  const tbody = $('#accountsTable tbody');
  tbody.innerHTML = '';
  $('#accountsEmpty').hidden = state.accounts.length > 0;
  state.accounts.forEach(a => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(a.label)}</td>
      <td class="mono">${a.provider}</td>
      <td class="mono">${escapeHtml(a.user)}</td>
      <td><span class="pill pill-active" id="status-${a.id}">connected</span></td>
      <td style="text-align:right; white-space:nowrap;">
        <button class="btn btn-small" data-action="test" data-id="${a.id}">Create test draft</button>
        <button class="btn btn-small btn-danger" data-action="delete" data-id="${a.id}">Remove</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

$('#accountsTable').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action === 'delete') {
    if (!confirm('Remove this account? Campaigns already using it keep running.')) return;
    await api(`/api/accounts/${id}`, { method: 'DELETE' });
    await loadAccounts();
  } else if (btn.dataset.action === 'test') {
    const status = $(`#status-${id}`);
    const original = status.textContent;
    status.textContent = 'creating draft…';
    try {
      await api(`/api/accounts/${id}/test-draft`, { method: 'POST' });
      status.textContent = 'draft created ✓';
      status.title = '';
      setTimeout(() => (status.textContent = original), 3000);
    } catch (err) {
      status.textContent = 'failed: ' + err.message;
      status.className = 'pill pill-cancelled';
      status.title = err.message; // full message on long-press/hover, in case it's truncated visually
    }
  }
});

$('#providerSelect').addEventListener('change', (e) => {
  const isCustom = e.target.value === 'custom';
  $$('.custom-only').forEach(f => (f.hidden = !isCustom));
});

$('#accountForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#accountFormMsg');
  msg.textContent = 'Connecting…';
  msg.className = 'form-msg';
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  body.secure = body.secure === 'true';
  try {
    await api('/api/accounts', { method: 'POST', body: JSON.stringify(body) });
    msg.textContent = 'Connected.';
    msg.className = 'form-msg is-ok';
    e.target.reset();
    $$('.custom-only').forEach(f => (f.hidden = true));
    await loadAccounts();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-msg is-error';
  }
});

// ================= NEW CAMPAIGN: RECIPIENTS (CSV + manual) =================
state.csvRecipients = [];
state.manualRecipients = [];

$('#csvInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const summary = $('#csvSummary');
  if (!file) return;
  try {
    let text = await file.text();
    text = text.replace(/^\uFEFF/, ''); // strip BOM some spreadsheet apps add
    state.csvRecipients = parseCsv(text);
    if (!state.csvRecipients.length) {
      summary.textContent = 'Could not find any valid rows in that file — check it has an email in the second column.';
      summary.style.color = 'var(--red)';
    } else {
      summary.textContent = `${state.csvRecipients.length} recipients loaded from CSV.`;
      summary.style.color = '';
    }
  } catch (err) {
    summary.textContent = 'Could not read that file: ' + err.message;
    summary.style.color = 'var(--red)';
    state.csvRecipients = [];
  }
  mergeRecipients();
});

$('#manualInput').addEventListener('input', (e) => {
  state.manualRecipients = parseCsv(e.target.value);
  const summary = $('#manualSummary');
  summary.textContent = state.manualRecipients.length
    ? `${state.manualRecipients.length} recipients from manual entry.`
    : '';
  mergeRecipients();
});

function mergeRecipients() {
  const seen = new Set();
  const combined = [];
  [...state.csvRecipients, ...state.manualRecipients].forEach(r => {
    const key = r.email.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    combined.push(r);
  });
  state.recipients = combined;
  $('#totalRecipientsSummary').textContent = combined.length
    ? `${combined.length} unique recipients ready.`
    : '';
  updateLaunchSummary();
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const rows = lines.map(line => splitCsvLine(line));
  // detect header: if second column of first row isn't an email, treat as header
  const looksLikeHeader = rows[0].length >= 2 && !/@/.test(rows[0][1] || '');
  const dataRows = looksLikeHeader ? rows.slice(1) : rows;
  return dataRows
    .map(cols => {
      // A line with just one column (no comma) is a bare email with no name,
      // e.g. someone pasting a plain list of addresses.
      if (cols.length === 1) return { name: '', email: cols[0].trim() };
      return { name: (cols[0] || '').trim(), email: (cols[1] || '').trim() };
    })
    .filter(r => /@/.test(r.email));
}

function splitCsvLine(line) {
  // handles simple quoted commas: "Smith, John",john@x.com
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// ================= NEW CAMPAIGN: TEMPLATES =================
function renderTemplates() {
  const list = $('#templatesList');
  list.innerHTML = '';
  state.templates.forEach((tpl, i) => {
    const row = document.createElement('div');
    row.className = 'template-row';
    const attachments = tpl.attachments || [];
    const chips = attachments.map((a, ai) => `
      <span class="attachment-chip">
        ${escapeHtml(a.filename)} (${formatBytes(a.size)})
        <button type="button" data-remove-attachment="${i}:${ai}" title="Remove">×</button>
      </span>
    `).join('');
    row.innerHTML = `
      <div class="template-row-head">
        <span>COPY ${i + 1}</span>
        ${state.templates.length > 1 ? `<button class="btn btn-small btn-danger" data-remove="${i}">Remove</button>` : ''}
      </div>
      <div class="field">
        <label>Subject</label>
        <input type="text" data-subject="${i}" placeholder="e.g. Quick idea for {{name}}" value="${escapeAttr(tpl.subject || '')}">
      </div>
      <div class="field">
        <label>Body</label>
        <textarea data-body="${i}" placeholder="Hello {{name}},&#10;&#10;...">${escapeHtml(tpl.body || '')}</textarea>
      </div>
      <div class="field">
        <label>Attachments — images or files, optional (8MB max each)</label>
        <input type="file" data-attach="${i}" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt">
        <p class="hint" data-attach-status="${i}"></p>
        <div class="attachment-chips">${chips}</div>
      </div>`;
    list.appendChild(row);
  });
}

$('#addTemplateBtn').addEventListener('click', () => {
  if (state.templates.length >= 5) { alert('Maximum 5 email copies.'); return; }
  state.templates.push({ subject: '', body: '', attachments: [] });
  renderTemplates();
});

$('#templatesList').addEventListener('input', (e) => {
  const s = e.target.dataset.subject;
  const b = e.target.dataset.body;
  if (s !== undefined) state.templates[s].subject = e.target.value;
  if (b !== undefined) state.templates[b].body = e.target.value;
  updateLaunchSummary();
});

$('#templatesList').addEventListener('click', (e) => {
  const idx = e.target.dataset.remove;
  if (idx !== undefined) {
    state.templates.splice(Number(idx), 1);
    renderTemplates();
    updateLaunchSummary();
    return;
  }
  const removeAttachment = e.target.dataset.removeAttachment;
  if (removeAttachment !== undefined) {
    const [tplIdx, attIdx] = removeAttachment.split(':').map(Number);
    state.templates[tplIdx].attachments.splice(attIdx, 1);
    renderTemplates();
  }
});

$('#templatesList').addEventListener('change', async (e) => {
  const tplIdx = e.target.dataset.attach;
  if (tplIdx === undefined) return;
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const status = $(`[data-attach-status="${tplIdx}"]`);
  if (!state.templates[tplIdx].attachments) state.templates[tplIdx].attachments = [];

  for (const file of files) {
    if (file.size > 8 * 1024 * 1024) {
      status.textContent = `${file.name} is over 8MB — skipped.`;
      status.style.color = 'var(--red)';
      continue;
    }
    status.textContent = `Uploading ${file.name}…`;
    status.style.color = '';
    try {
      const dataBase64 = await fileToBase64(file);
      const uploaded = await api('/api/attachments', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, contentType: file.type, dataBase64 })
      });
      state.templates[tplIdx].attachments.push(uploaded);
      status.textContent = '';
    } catch (err) {
      status.textContent = `${file.name} failed to upload: ${err.message}`;
      status.style.color = 'var(--red)';
    }
  }
  e.target.value = ''; // allow re-selecting the same file later
  renderTemplates();
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result; // "data:<mime>;base64,<data>"
      const commaIdx = result.indexOf(',');
      resolve(result.slice(commaIdx + 1));
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes) {
  if (!bytes) return '0KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// ================= NEW CAMPAIGN: ACCOUNT PICKER =================
function renderAccountPicker() {
  const list = $('#accountPickerList');
  if (!state.accounts.length) {
    list.innerHTML = '<p class="hint">No accounts connected yet — add one under "Sending accounts" first.</p>';
    return;
  }
  list.innerHTML = '';
  state.accounts.forEach(a => {
    const row = document.createElement('div');
    row.className = 'picker-row';
    row.innerHTML = `
      <div>
        <div class="acc-label">${escapeHtml(a.label)}</div>
        <div class="acc-provider">${a.provider} · ${escapeHtml(a.user)}</div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);">
        <input type="checkbox" data-pick="${a.id}"> use this account
      </label>
      <input type="number" min="1" max="100" placeholder="count" data-count="${a.id}" disabled>
    `;
    list.appendChild(row);
  });
}

$('#accountPickerList').addEventListener('change', (e) => {
  if (e.target.dataset.pick !== undefined) {
    const id = e.target.dataset.pick;
    const countInput = $(`[data-count="${id}"]`);
    countInput.disabled = !e.target.checked;
    if (e.target.checked && !countInput.value) countInput.value = 10;
  }
  updateLaunchSummary();
});
$('#accountPickerList').addEventListener('input', updateLaunchSummary);

// ================= NEW CAMPAIGN: TIMING + LAUNCH =================
$('#startMode').addEventListener('change', (e) => {
  $('#startAtField').hidden = e.target.value !== 'later';
});

function collectAccountsConfig() {
  return $$('#accountPickerList [data-pick]')
    .filter(cb => cb.checked)
    .map(cb => ({
      accountId: Number(cb.dataset.pick),
      sendCount: Number($(`[data-count="${cb.dataset.pick}"]`).value || 0)
    }));
}

function updateLaunchSummary() {
  const accounts = collectAccountsConfig();
  const totalMessages = accounts.reduce((s, a) => s + (a.sendCount || 0), 0);
  const templatesCount = state.templates.filter(t => t.body && t.body.trim()).length;

  const el = $('#launchSummary');
  if (!accounts.length || !totalMessages) {
    el.innerHTML = 'Select accounts and set send counts to see a summary.';
    return;
  }
  el.innerHTML = `
    <b>${accounts.length}</b> accounts &nbsp;·&nbsp;
    <b>${totalMessages}</b> drafts total &nbsp;·&nbsp;
    <b>${templatesCount || 0}</b> copies rotating &nbsp;·&nbsp;
    <b>${state.recipients.length}</b> recipients loaded<br>
    All accounts draft in parallel — ready within a few minutes regardless of total count.
  `;
}

$('#launchBtn').addEventListener('click', async () => {
  const msg = $('#launchMsg');
  msg.className = 'form-msg';
  const name = $('#campaignName').value.trim();
  const accounts = collectAccountsConfig();
  const templates = state.templates
    .filter(t => t.body && t.body.trim())
    .map(t => ({ subject: t.subject || '(no subject)', body: t.body, attachments: t.attachments || [] }));
  const startAt = $('#startMode').value === 'later' ? $('#startAt').value : null;

  if (!name) return (msg.textContent = 'Give the campaign a name.', msg.className = 'form-msg is-error');
  if (!accounts.length) return (msg.textContent = 'Pick at least one sending account.', msg.className = 'form-msg is-error');
  if (!templates.length) return (msg.textContent = 'Add at least one email copy.', msg.className = 'form-msg is-error');
  if (!state.recipients.length) return (msg.textContent = 'Upload a recipient CSV.', msg.className = 'form-msg is-error');

  msg.textContent = 'Creating drafts…';
  try {
    await api('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name, accounts, templates, recipients: state.recipients, startAt })
    });
    msg.textContent = 'Drafts queued.';
    msg.className = 'form-msg is-ok';
    // reset form for next campaign
    state.recipients = [];
    state.csvRecipients = [];
    state.manualRecipients = [];
    state.templates = [{ subject: '', body: '', attachments: [] }];
    $('#campaignName').value = '';
    $('#csvInput').value = '';
    $('#csvSummary').textContent = '';
    $('#manualInput').value = '';
    $('#manualSummary').textContent = '';
    $('#totalRecipientsSummary').textContent = '';
    renderTemplates();
    renderAccountPicker();
    setTimeout(() => showView('campaigns'), 700);
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-msg is-error';
  }
});

// ================= CAMPAIGNS LIST + DETAIL =================
let campaignPoll = null;

async function loadCampaigns() {
  const campaigns = await api('/api/campaigns');
  const tbody = $('#campaignsTable tbody');
  tbody.innerHTML = '';
  $('#campaignsEmpty').hidden = campaigns.length > 0;
  campaigns.forEach(c => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.innerHTML = `
      <td>${escapeHtml(c.name)}</td>
      <td><span class="pill pill-${c.status}">${c.status}</span></td>
      <td class="mono">${c.accountsUsed}</td>
      <td class="mono">${c.totals.drafted} / ${c.totals.total}</td>
      <td style="text-align:right;"><button class="btn btn-small" data-open="${c.id}">View</button></td>`;
    tr.addEventListener('click', () => openCampaignDetail(c.id));
    tbody.appendChild(tr);
  });
}

function closeCampaignDetail() {
  $('#campaignDetail').hidden = true;
  $('#campaignsListPanel').hidden = false;
  if (campaignPoll) { clearInterval(campaignPoll); campaignPoll = null; }
}

async function openCampaignDetail(id) {
  $('#campaignsListPanel').hidden = true;
  const detail = $('#campaignDetail');
  detail.hidden = false;
  await renderCampaignDetail(id);
  if (campaignPoll) clearInterval(campaignPoll);
  campaignPoll = setInterval(() => renderCampaignDetail(id), 15000);
}

async function renderCampaignDetail(id) {
  let c;
  try { c = await api(`/api/campaigns/${id}`); }
  catch (err) { $('#campaignDetail').innerHTML = `<p class="hint">${err.message}</p>`; return; }

  let total = 0, drafted = 0, failed = 0, pending = 0;
  c.perAccount.forEach(a => a.batches.forEach(b => b.recipients.forEach(r => {
    total++;
    if (r.status === 'drafted') drafted++;
    else if (r.status === 'failed') failed++;
    else pending++;
  })));

  const relayRows = c.perAccount.map(a => {
    const recipients = a.batches[0] ? a.batches[0].recipients : [];
    const accDrafted = recipients.filter(r => r.status === 'drafted').length;
    const accFailed = recipients.filter(r => r.status === 'failed').length;
    const accTotal = recipients.length;
    const done = a.batches[0] && a.batches[0].status === 'drafted';
    const cls = !done ? 'due' : (accFailed > 0 ? 'failed-some' : 'sent');
    const label = !done ? 'in progress' : (accFailed > 0 ? `${accFailed} failed` : 'done');
    return `<div class="relay-row">
      <div class="relay-label">${escapeHtml(a.accountLabel)}</div>
      <div class="relay-track">
        <div class="relay-node ${cls}" title="${label}">${accDrafted}/${accTotal}</div>
      </div>
    </div>`;
  }).join('');

  const canPause = c.status === 'running';
  const canResume = c.status === 'paused';
  const canCancel = c.status === 'running' || c.status === 'paused';

  $('#campaignDetail').innerHTML = `
    <button class="back-link" id="backToCampaigns">← All campaigns</button>
    <div class="detail-panel">
      <div class="detail-head">
        <div>
          <h2>${escapeHtml(c.name)}</h2>
          <span class="pill pill-${c.status}">${c.status}</span>
          <span class="hint" style="display:inline;">&nbsp; started ${new Date(c.startAt).toLocaleString()}</span>
        </div>
        <div class="detail-actions">
          ${canPause ? `<button class="btn btn-small" data-status="paused">Pause</button>` : ''}
          ${canResume ? `<button class="btn btn-small" data-status="running">Resume</button>` : ''}
          ${canCancel ? `<button class="btn btn-small btn-danger" data-status="cancelled">Cancel</button>` : ''}
        </div>
      </div>
      <div class="stat-row">
        <div class="stat"><span class="n">${total}</span><span class="l">Total</span></div>
        <div class="stat sent"><span class="n">${drafted}</span><span class="l">Drafted</span></div>
        <div class="stat pending"><span class="n">${pending}</span><span class="l">Pending</span></div>
        <div class="stat failed"><span class="n">${failed}</span><span class="l">Failed</span></div>
      </div>
      <div class="relay">${relayRows}</div>
    </div>
  `;

  $('#backToCampaigns').addEventListener('click', closeCampaignDetail);
  $$('#campaignDetail [data-status]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api(`/api/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify({ status: btn.dataset.status }) });
      renderCampaignDetail(id);
      loadCampaigns();
    });
  });
}

// ================= utils =================
function escapeHtml(str = '') {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(str = '') {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

// ================= boot =================
(async function init() {
  renderTemplates();
  await loadAccounts();
  renderAccountPicker();
  await loadCampaigns();
})();
