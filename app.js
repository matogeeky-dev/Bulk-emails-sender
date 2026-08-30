const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  accounts: [],
  recipients: [],
  templates: [{ subject: '', body: '' }], // start with one empty copy
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
        <button class="btn btn-small" data-action="test" data-id="${a.id}">Send test</button>
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
    status.textContent = 'sending…';
    try {
      await api(`/api/accounts/${id}/test-send`, { method: 'POST' });
      status.textContent = 'test sent ✓';
      setTimeout(() => (status.textContent = original), 3000);
    } catch (err) {
      status.textContent = 'failed';
      status.className = 'pill pill-cancelled';
      alert('Could not send: ' + err.message);
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

// ================= NEW CAMPAIGN: CSV =================
$('#csvInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  state.recipients = parseCsv(text);
  $('#csvSummary').textContent = `${state.recipients.length} recipients loaded.`;
  updateLaunchSummary();
});

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const rows = lines.map(line => splitCsvLine(line));
  // detect header: if second column of first row isn't an email, treat as header
  const looksLikeHeader = rows[0].length >= 2 && !/@/.test(rows[0][1] || '');
  const dataRows = looksLikeHeader ? rows.slice(1) : rows;
  return dataRows
    .map(cols => ({ name: (cols[0] || '').trim(), email: (cols[1] || '').trim() }))
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
  state.templates.forEach((body, i) => {
    const row = document.createElement('div');
    row.className = 'template-row';
    row.innerHTML = `
      <div class="template-row-head">
        <span>COPY ${i + 1}</span>
        ${state.templates.length > 1 ? `<button class="btn btn-small btn-danger" data-remove="${i}">Remove</button>` : ''}
      </div>
      <div class="field">
        <label>Subject</label>
        <input type="text" data-subject="${i}" placeholder="e.g. Quick idea for {{name}}" value="${escapeAttr(state.templates[i].subject || '')}">
      </div>
      <div class="field">
        <label>Body</label>
        <textarea data-body="${i}" placeholder="Hello {{name}},&#10;&#10;...">${escapeHtml(state.templates[i].body || '')}</textarea>
      </div>`;
    list.appendChild(row);
  });
}

$('#addTemplateBtn').addEventListener('click', () => {
  if (state.templates.length >= 5) { alert('Maximum 5 email copies.'); return; }
  state.templates.push({ subject: '', body: '' });
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
  if (idx === undefined) return;
  state.templates.splice(Number(idx), 1);
  renderTemplates();
  updateLaunchSummary();
});

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
  const spacing = Number($('#spacingHours').value || 0);
  const maxBatches = accounts.length ? Math.max(...accounts.map(a => Math.ceil((a.sendCount || 0) / 10))) : 0;
  const totalSpan = maxBatches > 1 ? (maxBatches - 1) * spacing : 0;

  const el = $('#launchSummary');
  if (!accounts.length || !totalMessages) {
    el.innerHTML = 'Select accounts and set send counts to see a summary.';
    return;
  }
  el.innerHTML = `
    <b>${accounts.length}</b> accounts &nbsp;·&nbsp;
    <b>${totalMessages}</b> messages total &nbsp;·&nbsp;
    <b>${templatesCount || 0}</b> copies rotating &nbsp;·&nbsp;
    <b>${state.recipients.length}</b> recipients loaded<br>
    ${maxBatches} batch(es) of up to 10, spaced ${spacing || '?'}h apart — full send completes in ~${totalSpan}h
  `;
}
$('#spacingHours').addEventListener('input', updateLaunchSummary);

$('#launchBtn').addEventListener('click', async () => {
  const msg = $('#launchMsg');
  msg.className = 'form-msg';
  const name = $('#campaignName').value.trim();
  const accounts = collectAccountsConfig();
  const templates = state.templates
    .filter(t => t.body && t.body.trim())
    .map(t => ({ subject: t.subject || '(no subject)', body: t.body }));
  const spacingHours = Number($('#spacingHours').value);
  const startAt = $('#startMode').value === 'later' ? $('#startAt').value : null;

  if (!name) return (msg.textContent = 'Give the campaign a name.', msg.className = 'form-msg is-error');
  if (!accounts.length) return (msg.textContent = 'Pick at least one sending account.', msg.className = 'form-msg is-error');
  if (!templates.length) return (msg.textContent = 'Add at least one email copy.', msg.className = 'form-msg is-error');
  if (!state.recipients.length) return (msg.textContent = 'Upload a recipient CSV.', msg.className = 'form-msg is-error');

  msg.textContent = 'Launching…';
  try {
    await api('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name, accounts, templates, recipients: state.recipients, spacingHours, startAt })
    });
    msg.textContent = 'Launched.';
    msg.className = 'form-msg is-ok';
    // reset form for next campaign
    state.recipients = [];
    state.templates = [{ subject: '', body: '' }];
    $('#campaignName').value = '';
    $('#csvInput').value = '';
    $('#csvSummary').textContent = '';
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
      <td class="mono">${c.totals.sent} / ${c.totals.total}</td>
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

  let total = 0, sent = 0, failed = 0, pending = 0;
  c.perAccount.forEach(a => a.batches.forEach(b => b.recipients.forEach(r => {
    total++;
    if (r.status === 'sent') sent++;
    else if (r.status === 'failed') failed++;
    else pending++;
  })));

  const relayRows = c.perAccount.map(a => {
    const nodes = a.batches.map(b => {
      const anyFailed = b.recipients.some(r => r.status === 'failed');
      const cls = b.status === 'sent' ? (anyFailed ? 'failed-some' : 'sent') : 'due';
      return `<div class="relay-node ${cls}" title="Batch ${b.batchIndex + 1} · ${b.status}">${b.batchIndex + 1}</div>`;
    }).join('');
    return `<div class="relay-row">
      <div class="relay-label">${escapeHtml(a.accountLabel)}</div>
      <div class="relay-track">${nodes}</div>
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
          <span class="hint" style="display:inline;">&nbsp; started ${new Date(c.startAt).toLocaleString()} · gap ${c.spacingHours}h</span>
        </div>
        <div class="detail-actions">
          ${canPause ? `<button class="btn btn-small" data-status="paused">Pause</button>` : ''}
          ${canResume ? `<button class="btn btn-small" data-status="running">Resume</button>` : ''}
          ${canCancel ? `<button class="btn btn-small btn-danger" data-status="cancelled">Cancel</button>` : ''}
        </div>
      </div>
      <div class="stat-row">
        <div class="stat"><span class="n">${total}</span><span class="l">Total</span></div>
        <div class="stat sent"><span class="n">${sent}</span><span class="l">Sent</span></div>
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
