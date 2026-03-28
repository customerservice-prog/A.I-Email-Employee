const API_BASE =
  window.location.port === '3043' || window.location.port === '3000'
    ? `http://${window.location.hostname}:3042/api`
    : '/api';

const TENANT_ID = 'default';
const SESSION_KEY = 'inboxpilot_demo_session_v1';

function hasSession() {
  if (typeof window !== 'undefined' && window.INBOXPILOT_SKIP_AUTH === true) {
    return true;
  }
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const j = JSON.parse(raw);
    return Boolean(j && j.email);
  } catch {
    return false;
  }
}

function getSessionEmail() {
  if (typeof window !== 'undefined' && window.INBOXPILOT_SKIP_AUTH === true) {
    return 'Development (auth skipped)';
  }
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw).email : '';
  } catch {
    return '';
  }
}

function setSession(email) {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ email: String(email || '').trim(), at: Date.now() })
  );
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function apiKeyHeaders() {
  const k =
    typeof window !== 'undefined' && window.INBOXPILOT_API_SECRET
      ? String(window.INBOXPILOT_API_SECRET).trim()
      : '';
  return k ? { 'x-inboxpilot-key': k } : {};
}

function jsonHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-tenant-id': TENANT_ID,
    ...apiKeyHeaders(),
  };
}

function tenantHeaders() {
  return { 'x-tenant-id': TENANT_ID, ...apiKeyHeaders() };
}

function unwrapApiBody(body, res) {
  if (!res.ok) {
    const msg = body.error?.message || body.error;
    throw new Error(
      typeof msg === 'string' ? msg : msg ? JSON.stringify(msg) : `${res.status}`
    );
  }
  if (body && body.success === true && 'data' in body) return body.data;
  return body;
}

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: tenantHeaders() });
  const body = await res.json().catch(() => ({}));
  return unwrapApiBody(body, res);
}

async function apiJson(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: jsonHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return unwrapApiBody(data, res);
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function normalizeTrack(t) {
  const x = String(t || '').toLowerCase();
  if (x === 'auto' || x === 'auto_pilot') return 'auto';
  return 'review';
}

function parseRoute() {
  const h = (window.location.hash || '#/dashboard').replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  const params = new URLSearchParams(qs || '');
  let name = (path.replace(/^\//, '') || 'dashboard').split('/')[0];
  if (name === 'signin' || name === 'login') name = 'signin';
  return {
    name,
    id: params.get('id'),
  };
}

let reviewSelectedId = null;
let knowledgeSelectedFileId = null;

function setActiveNav(name) {
  document.querySelectorAll('.nav a').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('data-route') === name);
  });
}

async function updateSystemStatus() {
  const apiDot = document.getElementById('live-dot');
  const valApi = document.getElementById('val-api');
  const dotEmail = document.getElementById('dot-email');
  const valEmail = document.getElementById('val-email');
  const dotAi = document.getElementById('dot-ai');
  const valAi = document.getElementById('val-ai');
  const footerEmail = document.getElementById('footer-email');
  const footerModel = document.getElementById('footer-model');

  let healthOk = false;
  try {
    const base = API_BASE.replace(/\/api$/, '');
    const res = await fetch(`${base}/health`);
    healthOk = res.ok;
  } catch {
    healthOk = false;
  }

  if (apiDot) {
    apiDot.classList.toggle('live', healthOk);
    apiDot.classList.toggle('warn', !healthOk);
  }
  if (valApi) valApi.textContent = healthOk ? 'Reachable' : 'Offline';

  try {
    const s = await apiGet('/settings');
    if (footerEmail) {
      footerEmail.textContent = s.businessEmail || 'Not set in settings';
    }
    if (footerModel) {
      const dm = s.displayModel || 'gpt-4o';
      footerModel.textContent = dm.replace(/^gpt-/i, 'GPT-').replace(/mini/i, 'mini');
    }
    const nylasOk = Boolean(s.nylasConfigured);
    if (dotEmail) {
      dotEmail.className = 'status-dot' + (nylasOk ? ' live' : ' warn');
    }
    if (valEmail) {
      valEmail.textContent = nylasOk ? 'Nylas ready' : 'Not configured';
    }
    const aiOk = Boolean(s.openAiKeyConfigured);
    if (dotAi) {
      dotAi.className = 'status-dot' + (aiOk ? ' live' : ' bad');
    }
    if (valAi) {
      valAi.textContent = aiOk ? 'OpenAI ready' : 'Server key missing';
    }
  } catch (e) {
    if (footerEmail) {
      const msg = e && e.message ? String(e.message) : '';
      footerEmail.textContent =
        msg === 'Database not configured' ? 'Database not configured' : 'API error';
    }
    if (valEmail) valEmail.textContent = '—';
    if (valAi) valAi.textContent = '—';
    if (dotEmail) dotEmail.className = 'status-dot bad';
    if (dotAi) dotAi.className = 'status-dot bad';
  }
}

async function updateReviewBadge() {
  const badge = document.getElementById('nav-review-badge');
  if (!badge) return;
  try {
    const st = await apiGet('/stats');
    const n = st.pendingReview || 0;
    badge.textContent = String(n);
    badge.hidden = n === 0;
  } catch {
    badge.hidden = true;
  }
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtPct(x) {
  if (x == null || Number.isNaN(Number(x))) return '—';
  return `${Math.round(Number(x) * 100)}%`;
}

function fmtBytes(n) {
  const v = Number(n);
  if (v == null || Number.isNaN(v) || v < 0) return '—';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

function flagsList(flags) {
  if (!flags) return [];
  if (Array.isArray(flags)) return flags;
  try {
    return JSON.parse(flags);
  } catch {
    return [];
  }
}

function confTier(conf) {
  const c = Number(conf);
  if (Number.isNaN(c)) return 'mid';
  if (c >= 0.85) return 'high';
  if (c >= 0.65) return 'mid';
  return 'low';
}

function confidenceBlock(conf) {
  const c = conf != null ? Number(conf) : null;
  const pct =
    c != null && !Number.isNaN(c) ? Math.min(100, Math.round(c * 100)) : null;
  const tier = confTier(c);
  const w = pct != null ? pct : 0;
  return `<div class="conf-wrap conf-wrap--${tier}" title="Classifier confidence">
    <div class="conf-bar"><i style="width:${w}%"></i></div>
    <span class="conf-pct">${pct != null ? `${pct}%` : '—'}</span>
  </div>`;
}

function trackPill(trackKey) {
  const auto = trackKey === 'auto';
  return `<span class="pill-track pill-track--${auto ? 'auto' : 'review'}">${auto ? 'Auto' : 'Review'}</span>`;
}

function statusBadge(status) {
  const s = String(status || '').toLowerCase() || 'unknown';
  const map = {
    pending: 'pending',
    sent: 'sent',
    escalated: 'escalated',
    failed: 'failed',
  };
  const key = map[s] ? `badge-status--${map[s]}` : '';
  const label =
    s === 'pending'
      ? 'Pending'
      : s === 'sent'
        ? 'Sent'
        : s === 'escalated'
          ? 'Escalated'
          : s === 'failed'
            ? 'Failed'
            : escapeHtml(s);
  return `<span class="badge-status ${key}">${label}</span>`;
}

function pageHeader(title, desc, actionsHtml) {
  return `<header class="page-header">
    <div class="page-header__text">
      <h1 class="page-title">${escapeHtml(title)}</h1>
      ${desc ? `<p class="page-desc">${desc}</p>` : ''}
    </div>
    ${actionsHtml ? `<div class="page-header__actions">${actionsHtml}</div>` : ''}
  </header>`;
}

function parseActivitySnapshot(a) {
  let snap = a.payload_snapshot;
  if (typeof snap === 'string') {
    try {
      snap = JSON.parse(snap);
    } catch {
      snap = {};
    }
  }
  return snap && typeof snap === 'object' ? snap : {};
}

function activityRowHtml(a) {
  const snap = parseActivitySnapshot(a);
  const mode = String(snap.mode || '').toLowerCase();
  const ok = a.success !== false;
  const subj = a.subject || a.from_email || 'Message';
  let text = '';
  let dot = 'activity-dot';
  if (!ok) {
    text = `Send failed · ${subj}`;
    dot += ' activity-dot--fail';
  } else if (mode === 'auto') {
    text = `Auto-sent reply · ${subj}`;
    dot += ' activity-dot--auto';
  } else if (mode === 'manual') {
    text = `Approved reply sent · ${subj}`;
    dot += ' activity-dot--manual';
  } else {
    text = `Outbound · ${subj}`;
  }
  return `<div class="activity-item">
    <span class="${dot}" aria-hidden="true"></span>
    <div class="activity-body">${escapeHtml(text)}</div>
    <span class="activity-time">${fmtTime(a.created_at)}</span>
  </div>`;
}

function skeletonDashboard() {
  const card = `<div class="sk-stat"><div class="skeleton sk-line short"></div><div class="skeleton sk-line" style="height:2rem;margin-top:0.5rem"></div><div class="skeleton sk-line tiny" style="margin-top:0.5rem"></div></div>`;
  const col = `<div class="sk-panel"><div class="skeleton sk-line short"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line"></div></div>`;
  return `<div class="sk-stats">${card}${card}${card}${card}</div><div class="two-col">${col}${col}</div>`;
}

function skeletonTableRows(n) {
  let h = '';
  for (let i = 0; i < n; i++) {
    h += `<div class="sk-table-row"><div class="skeleton sk-line" style="flex:1"></div><div class="skeleton sk-line short" style="width:80px"></div></div>`;
  }
  return h;
}

function trustCardHtml(e, context) {
  const reason = (e.classification_reasoning || '').trim();
  const fl = flagsList(e.flags);
  const conf = e.confidence != null ? Number(e.confidence) : null;
  const pct =
    conf != null && !Number.isNaN(conf) ? Math.min(100, Math.round(conf * 100)) : null;
  let summary = '';
  if (context === 'review') {
    summary =
      'Held in Human Loop when confidence is below your auto-send threshold and/or the classifier raised flags that should be reviewed by a person.';
  } else if (context === 'auto') {
    summary =
      'Auto-Pilot sent this because confidence met your threshold on the server and no blocking flags were raised for this thread.';
  } else {
    summary = 'Classifier snapshot for this thread (same data the model saw when routing).';
  }
  const flagsHtml = fl.length
    ? fl.map((t) => `<span class="flag-tag">${escapeHtml(t)}</span>`).join('')
    : '<span class="flag-tag" style="opacity:0.75">No risk flags</span>';
  const reasonBlock = reason
    ? escapeHtml(reason)
    : 'No reasoning text was stored (older message, manual import, or classifier stub).';
  return `<div class="trust-card">
    <div class="trust-card__label">Classifier reasoning</div>
    <p class="trust-card__reason">${reasonBlock}</p>
    <p class="page-desc" style="margin:0 0 0.65rem;font-size:0.82rem;line-height:1.5">${escapeHtml(summary)}</p>
    <div class="trust-card__flags">${flagsHtml}</div>
    <div class="trust-card__conf">
      ${confidenceBlock(conf)}
      <span>Confidence${pct != null ? ` ${pct}%` : ''} · threshold applies on the server before send</span>
    </div>
  </div>`;
}

function onboardingChecklistHtml(ctx) {
  const s1 = Boolean(ctx.nylasConfigured);
  const s2 = ctx.kbCount > 0;
  const s3 = localStorage.getItem('inboxpilot_seen_threshold') === '1';
  const s4 = Boolean(ctx.hasEmails);
  const allDone = s1 && s2 && s3 && s4;
  if (allDone) return '';
  const steps = [
    {
      done: s1,
      title: 'Connect inbound email',
      desc:
        'Add Nylas API credentials and a grant on the server so live mail can flow in.',
      href: '#/settings',
      link: 'Open Settings',
    },
    {
      done: s2,
      title: 'Upload your knowledge base',
      desc: 'Pricing, policies, and FAQs power accurate drafts and safer auto-send.',
      href: '#/knowledge',
      link: 'Knowledge Base',
    },
    {
      done: s3,
      title: 'Set auto-send threshold',
      desc: 'Higher values are more conservative — fewer auto-sends, more review.',
      href: '#/settings',
      link: 'AI engine',
    },
    {
      done: s4,
      title: 'Process customer mail',
      desc: 'When messages arrive, they show on Dashboard and Inbox Feed in real time.',
      href: '#/inbox',
      link: 'Inbox Feed',
    },
  ];
  const lis = steps
    .map((step, i) => {
      const cls = step.done ? 'done' : 'pending';
      return `<li class="${cls}">
      <span class="step-ix">${step.done ? '✓' : i + 1}</span>
      <div class="step-body">
        <strong>${escapeHtml(step.title)}</strong>
        <span>${escapeHtml(step.desc)} </span>
        <a href="${step.href}">${escapeHtml(step.link)}</a>
      </div>
    </li>`;
    })
    .join('');
  return `<section class="onboarding-steps" aria-label="Setup checklist">
    <h2>Get ready to go live</h2>
    <ol>${lis}</ol>
  </section>`;
}

function viewSignIn(main) {
  main.innerHTML = `<div class="auth-screen">
    <div class="auth-card">
      <h1>Sign in to InboxPilot</h1>
      <p class="sub">Production teams plug in Clerk, Auth0, or Supabase here. For this build, sign-in is a local demo session only — nothing is sent to an auth provider.</p>
      <div class="auth-banner">Use any work email and password to open the workspace. Replace this screen when you ship real authentication.</div>
      <label for="auth-email">Work email</label>
      <input type="email" id="auth-email" autocomplete="username" placeholder="you@company.com" />
      <label for="auth-pass">Password</label>
      <input type="password" id="auth-pass" autocomplete="current-password" placeholder="Enter any value" />
      <div class="auth-actions">
        <button type="button" class="btn btn-primary" id="auth-submit">Continue to workspace</button>
      </div>
    </div>
  </div>`;
  const go = () => {
    const email = main.querySelector('#auth-email').value.trim() || 'operator@workspace.local';
    setSession(email);
    document.body.classList.remove('ip-guest');
    const rib = document.getElementById('main-ribbon');
    if (rib) rib.hidden = false;
    syncRibbon();
    window.location.hash = '#/dashboard';
    render().catch(console.error);
  };
  main.querySelector('#auth-submit').addEventListener('click', go);
  main.querySelector('#auth-pass').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') go();
  });
}

function syncRibbon() {
  const el = document.getElementById('ribbon-email');
  if (el) el.textContent = getSessionEmail() || 'Signed in';
  const lo = document.getElementById('ribbon-logout');
  if (lo && !lo._bound) {
    lo._bound = true;
    lo.addEventListener('click', () => {
      clearSession();
      document.body.classList.add('ip-guest');
      const rib = document.getElementById('main-ribbon');
      if (rib) rib.hidden = true;
      window.location.hash = '#/signin';
      render().catch(console.error);
    });
  }
}

function kbStatusClass(st) {
  const s = String(st || '').toLowerCase();
  if (s === 'ready') return 'kb-status kb-status--ready';
  if (s === 'failed') return 'kb-status kb-status--failed';
  if (s === 'processing' || s === 'uploaded') return 'kb-status kb-status--processing';
  return 'kb-status';
}

function showErrorIn(main, err) {
  main.insertAdjacentHTML(
    'afterbegin',
    `<div class="error-toast">${escapeHtml(err.message)}</div>`
  );
}

function showError(err) {
  console.error(err);
  const main = document.getElementById('main');
  if (main && !main.querySelector('.error-toast')) {
    showErrorIn(main, err);
  }
}

async function viewDashboard(main) {
  main.innerHTML = `<div class="page-wrap">
    ${pageHeader(
      'Dashboard',
      'Operational command center — volume, automation, and audit trail in one place.'
    )}
    <div id="dash-body">${skeletonDashboard()}</div>
  </div>`;
  const bodyEl = main.querySelector('#dash-body');

  let st;
  let settingsMini = {};
  let kbFiles = [];
  try {
    const [a, b, c] = await Promise.all([
      apiGet('/stats'),
      apiGet('/settings').catch(() => ({})),
      apiGet('/knowledge/files').catch(() => ({ files: [] })),
    ]);
    st = a;
    settingsMini = b;
    kbFiles = c.files || [];
  } catch (e) {
    bodyEl.innerHTML = `<div class="error-toast">${escapeHtml(e.message)}</div>
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-title">Dashboard</h1>
          <p class="page-desc">Run <code class="code-inline">npm start</code> and open this app from the server. Set <code class="code-inline">DATABASE_URL=pglite</code> in <code class="code-inline">.env</code> for embedded Postgres (see <code class="code-inline">.env.example</code>).</p>
        </div>
      </header>`;
    return;
  }

  const pending = st.pendingReview || 0;
  const avg = st.avgConfidence7d;
  const recent = st.recentEmails || [];
  const hasEmails =
    recent.length > 0 ||
    (st.emailsToday ?? 0) > 0 ||
    (st.autoPilotSentToday ?? 0) > 0;

  const onboard = onboardingChecklistHtml({
    nylasConfigured: settingsMini.nylasConfigured,
    kbCount: kbFiles.length,
    hasEmails,
  });

  const quiet = !hasEmails && pending === 0;

  const hint = quiet
    ? `<div class="onboarding-hint">
        <strong>No live mail yet.</strong> Connect your inbox on the server (Nylas), upload policies in
        <a href="#/knowledge">Knowledge Base</a>, then open <a href="#/inbox">Inbox Feed</a> — or explore
        sample data from a fresh <code class="code-inline">npm run db:setup</code> seed.
      </div>`
    : '';

  bodyEl.innerHTML = `${onboard}${hint}
    <div class="grid-stats">
      <div class="stat-card">
        <div class="stat-label">Total emails today</div>
        <div class="stat-value">${st.emailsToday ?? 0}</div>
        <div class="stat-meta">Compared to midnight UTC · live count</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Auto-Pilot sent</div>
        <div class="stat-value">${st.autoPilotSentToday ?? 0}</div>
        <div class="stat-meta">No human approval · audit in Auto-Pilot Log</div>
      </div>
      <div class="stat-card${pending > 0 ? ' stat-card--alert' : ''}">
        <div class="stat-label">Pending review</div>
        <div class="stat-value">${pending}</div>
        <div class="stat-meta">${pending > 0 ? 'Open Review Queue to approve or escalate' : 'Nothing waiting in Human Loop'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg confidence (7d)</div>
        <div class="stat-value">${avg != null ? fmtPct(avg) : '—'}</div>
        <div class="stat-meta">Rolling classifier average</div>
      </div>
    </div>
    <div class="two-col">
      <div class="panel">
        <h2 class="panel__title">Recent emails</h2>
        <div id="dash-emails"></div>
      </div>
      <div class="panel">
        <h2 class="panel__title">Activity feed</h2>
        <div id="dash-activity"></div>
      </div>
    </div>`;

  const de = main.querySelector('#dash-emails');
  const da = main.querySelector('#dash-activity');

  for (const e of recent) {
    const tk = normalizeTrack(e.track);
    const conf = e.confidence != null ? Number(e.confidence) : 0;
    const row = document.createElement('div');
    row.className = 'dash-email-row';
    row.innerHTML = `
      <div>
        <div class="email-cell__name">${escapeHtml(e.from_display_name || e.from_email)}</div>
        <div class="email-cell__sub">${escapeHtml(e.subject || '(no subject)')}</div>
      </div>
      ${trackPill(tk)}
      ${confidenceBlock(conf)}
      <span style="color:var(--muted);font-size:0.8rem;text-align:right">${fmtTime(e.created_at)}</span>`;
    row.addEventListener('click', () => {
      if (tk === 'review' && String(e.status).toLowerCase() === 'pending') {
        reviewSelectedId = e.id;
        window.location.hash = '#/review';
      } else {
        window.location.hash = '#/inbox';
      }
    });
    de.appendChild(row);
  }
  if (!recent.length) {
    de.innerHTML = `<div class="empty-state">
      <div class="empty-state__title">No emails to show yet</div>
      Connect your inbox (Nylas on the server) to process real customer mail. After <code class="code-inline">npm run db:setup</code>, sample threads appear here for a guided first run.
    </div>`;
  }

  for (const a of st.activity || []) {
    da.insertAdjacentHTML('beforeend', activityRowHtml(a));
  }
  if (!st.activity?.length) {
    da.innerHTML = `<div class="empty-state">
      <div class="empty-state__title">No outbound activity yet</div>
      When Auto-Pilot or an operator sends a reply, a row is written here for accountability — same source as your audit log.
    </div>`;
  }
}

async function viewInbox(main) {
  let cachedEmails = [];
  let selectedDetail = null;

  main.innerHTML = `<div class="page-wrap">
    ${pageHeader(
      'Inbox Feed',
      'All inbound customer emails processed by InboxPilot.',
      `<input type="search" id="inbox-search" placeholder="Search sender, subject…" style="min-width:200px" />
      <button class="btn btn-ghost" type="button" id="inbox-refresh">Refresh</button>`
    )}
    <div class="toolbar">
      <label>Track
        <select id="inbox-track">
          <option value="">All</option>
          <option value="auto">Auto-Pilot</option>
          <option value="review">Human Loop</option>
        </select>
      </label>
      <label>Status
        <select id="inbox-status">
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="sent">Sent</option>
          <option value="escalated">Escalated</option>
          <option value="failed">Failed</option>
        </select>
      </label>
      <button type="button" class="filter-reset" id="inbox-reset">Reset filters</button>
    </div>
    <div class="data-table-wrap" id="inbox-table-wrap">
      <table class="data-table" id="inbox-table">
        <thead><tr>
          <th>Sender</th>
          <th>Subject & preview</th>
          <th>Track</th>
          <th>Status</th>
          <th>Confidence</th>
          <th style="text-align:right">Received</th>
        </tr></thead>
        <tbody id="inbox-tbody"><tr><td colspan="6" style="padding:0;border:none"><div class="sk-panel" style="margin:0;border:none;border-radius:0;box-shadow:none">${skeletonTableRows(6)}</div></td></tr></tbody>
      </table>
    </div>
    <div id="inbox-detail-mount"></div>
  </div>`;

  const tbody = main.querySelector('#inbox-tbody');
  const searchEl = main.querySelector('#inbox-search');
  const detailMount = main.querySelector('#inbox-detail-mount');

  function matchesSearch(e, q) {
    if (!q) return true;
    const blob = [
      e.from_display_name,
      e.from_email,
      e.subject,
      e.body,
      e.body_cleaned,
      e.body_raw,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return blob.includes(q);
  }

  function renderDetail() {
    if (!selectedDetail) {
      detailMount.innerHTML = '';
      return;
    }
    const e = selectedDetail;
    const tk = normalizeTrack(e.track);
    const st = String(e.status || '').toLowerCase();
    const trust =
      tk === 'review' && st === 'pending'
        ? ''
        : trustCardHtml(e, tk === 'auto' && st === 'sent' ? 'auto' : 'inbox');
    detailMount.innerHTML = `<div class="inbox-detail">
      <div class="inbox-detail__head">
        <div>
          <div class="page-title" style="font-size:1rem;margin:0">${escapeHtml(e.subject || '(no subject)')}</div>
          <p class="page-desc" style="margin:0.35rem 0 0;font-size:0.85rem">${escapeHtml(e.from_display_name || '')} · ${escapeHtml(e.from_email || '')}</p>
        </div>
        <button type="button" class="inbox-detail__close" id="inbox-detail-close">Close</button>
      </div>
      ${trust}
      <div class="ap-detail-grid">
        <div>
          <div class="panel__title" style="margin-bottom:0.5rem">Inbound</div>
          <p class="body-preview" style="margin:0">${escapeHtml(e.body || '')}</p>
        </div>
        <div>
          <div class="panel__title" style="margin-bottom:0.5rem">Reply / draft</div>
          <p class="body-preview" style="margin:0">${escapeHtml(e.final_reply || e.draft || '—')}</p>
        </div>
      </div>
    </div>`;
    detailMount.querySelector('#inbox-detail-close').addEventListener('click', () => {
      selectedDetail = null;
      renderDetail();
      main.querySelectorAll('#inbox-tbody tr').forEach((tr) => tr.classList.remove('row-selected'));
    });
  }

  function renderRows() {
    const q = (searchEl.value || '').trim().toLowerCase();
    tbody.innerHTML = '';
    const list = (cachedEmails || []).filter((e) => matchesSearch(e, q));
    for (const e of list) {
      const tk = normalizeTrack(e.track);
      const conf = e.confidence != null ? Number(e.confidence) : 0;
      const st = String(e.status || '').toLowerCase();
      const snippet = (e.body || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const tr = document.createElement('tr');
      if (selectedDetail && selectedDetail.id === e.id) tr.classList.add('row-selected');
      tr.innerHTML = `
        <td>
          <div class="email-cell__name">${escapeHtml(e.from_display_name || e.from_email)}</div>
          <div class="email-cell__sub">${escapeHtml(e.from_email || '')}</div>
        </td>
        <td>
          <div class="email-cell__name" style="font-weight:600;font-size:0.86rem">${escapeHtml(e.subject || '')}</div>
          <div class="snippet-preview">${escapeHtml(snippet || '—')}</div>
        </td>
        <td>${trackPill(tk)}</td>
        <td>${statusBadge(st)}</td>
        <td>${confidenceBlock(conf)}</td>
        <td style="text-align:right;color:var(--muted);font-size:0.82rem">${fmtTime(e.received_at || e.created_at)}</td>`;
      tr.addEventListener('click', () => {
        if (tk === 'review' && st === 'pending') {
          reviewSelectedId = e.id;
          window.location.hash = '#/review';
          return;
        }
        if (tk === 'auto' && st === 'sent') {
          selectedDetail = e;
          main.querySelectorAll('#inbox-tbody tr').forEach((r) => r.classList.remove('row-selected'));
          tr.classList.add('row-selected');
          renderDetail();
          return;
        }
        selectedDetail = e;
        main.querySelectorAll('#inbox-tbody tr').forEach((r) => r.classList.remove('row-selected'));
        tr.classList.add('row-selected');
        renderDetail();
      });
      tbody.appendChild(tr);
    }
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">
        <div class="empty-state__title">No threads match</div>
        Try clearing filters or search — or connect your inbox on the server so new mail appears here automatically.
      </div></td></tr>`;
    }
  }

  async function load() {
    const tr = main.querySelector('#inbox-track').value;
    const st = main.querySelector('#inbox-status').value;
    const params = new URLSearchParams({ limit: '100' });
    if (st) params.set('status', st);
    if (tr) params.set('track', tr);
    const data = await apiGet(`/emails?${params}`);
    cachedEmails = data.emails || [];
    selectedDetail = null;
    renderRows();
    renderDetail();
  }

  main.querySelector('#inbox-refresh').addEventListener('click', () => load().catch(showError));
  main.querySelector('#inbox-track').addEventListener('change', () => load().catch(showError));
  main.querySelector('#inbox-status').addEventListener('change', () => load().catch(showError));
  main.querySelector('#inbox-reset').addEventListener('click', () => {
    main.querySelector('#inbox-track').value = '';
    main.querySelector('#inbox-status').value = '';
    searchEl.value = '';
    load().catch(showError);
  });
  searchEl.addEventListener('input', () => renderRows());

  await load().catch((e) => showErrorIn(main, e));
}

async function viewReview(main, route) {
  if (route.id) reviewSelectedId = parseInt(route.id, 10);
  main.innerHTML = `<div class="page-wrap">
    ${pageHeader(
      'Review Queue',
      'Approve, edit, or escalate — every send is explicit. Keyboard: Tab into the draft, edit, then Approve & Send.'
    )}
    <div id="review-error"></div>
    <div class="review-layout">
      <div class="review-list">
        <div class="review-list__head">Pending review</div>
        <div class="review-list__scroll" id="review-list"><div class="sk-panel" style="margin:0.75rem;border:none;box-shadow:none">${skeletonTableRows(5)}</div></div>
      </div>
      <div class="review-center" id="review-center"><div class="sk-panel" style="margin:0"><div class="skeleton sk-line short"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line"></div><p class="page-desc" style="margin:1rem 0 0">Loading message…</p></div></div>
      <div class="review-right" id="review-right"><div class="sk-panel" style="margin:0"><div class="skeleton sk-line" style="height:200px"></div></div></div>
    </div>
  </div>`;

  let emails = [];
  try {
    const data = await apiGet('/emails?status=pending&track=review&limit=100');
    emails = data.emails || [];
  } catch (e) {
    main.querySelector('#review-error').innerHTML = `<div class="error-toast">${escapeHtml(e.message)}</div>`;
    main.querySelector('#review-list').innerHTML = '';
    main.querySelector('#review-center').innerHTML = '';
    main.querySelector('#review-right').innerHTML = '';
    return;
  }

  const listEl = main.querySelector('#review-list');
  const centerEl = main.querySelector('#review-center');
  const rightEl = main.querySelector('#review-right');

  if (!emails.length) {
    listEl.innerHTML = `<div class="empty-state empty-state--success" style="margin:1rem;border:none">
      <div class="empty-state__title">You are all caught up</div>
      There is nothing waiting for a human decision. High-confidence mail is handled by Auto-Pilot; uncertain threads appear here automatically when they arrive.
      <div style="margin-top:1rem;font-size:0.85rem;color:var(--muted)">Tip: open <a href="#/inbox">Inbox Feed</a> to inspect every thread, or <a href="#/autopilot">Auto-Pilot Log</a> for sent automation.</div>
    </div>`;
    centerEl.innerHTML = `<div class="empty-state" style="padding:2rem 1rem">
      <div class="empty-state__title">Select a conversation</div>
      When items appear in the queue, metadata and the full customer message show in this column.
    </div>`;
    rightEl.innerHTML = `<div class="empty-state" style="padding:2rem 1rem">
      <div class="empty-state__title">Suggested reply</div>
      The AI draft and Approve / Escalate / Regenerate actions appear here for the selected email.
    </div>`;
    return;
  }

  if (!reviewSelectedId || !emails.some((x) => x.id === reviewSelectedId)) {
    reviewSelectedId = emails[0].id;
  }

  let originalDraftText = '';

  function renderList() {
    listEl.innerHTML = '';
    for (const e of emails) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'review-list-item' + (e.id === reviewSelectedId ? ' active' : '');
      const snippet = (e.body || '').replace(/\s+/g, ' ').trim().slice(0, 72);
      btn.innerHTML = `<div style="font-weight:600">${escapeHtml(e.from_display_name || e.from_email)}</div>
        <div class="sub">${escapeHtml(e.subject || '')}</div>
        ${snippet ? `<div class="sub">${escapeHtml(snippet)}</div>` : ''}
        <div class="conf">${fmtPct(e.confidence)} confidence</div>`;
      btn.addEventListener('click', () => {
        reviewSelectedId = e.id;
        renderList();
        renderDetail();
      });
      listEl.appendChild(btn);
    }
  }

  function clearDraftError() {
    const ex = rightEl.querySelector('.draft-inline-error');
    if (ex) ex.remove();
  }

  function showDraftError(message, onRetry) {
    clearDraftError();
    const wrap = document.createElement('div');
    wrap.className = 'draft-inline-error';
    wrap.innerHTML = `<span>${escapeHtml(message)}</span>`;
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Retry send';
    b.addEventListener('click', onRetry);
    wrap.appendChild(b);
    rightEl.appendChild(wrap);
  }

  async function renderDetail() {
    const e = emails.find((x) => x.id === reviewSelectedId);
    if (!e) return;
    const fl = flagsList(e.flags);
    const tags = fl.length
      ? fl.map((t) => `<span class="flag-tag">${escapeHtml(t)}</span>`).join('')
      : '<span class="flag-tag">No routing flags</span>';
    centerEl.innerHTML = `${trustCardHtml(e, 'review')}
      <div class="meta-block"><strong>From</strong> ${escapeHtml(e.from_display_name || '')} &lt;${escapeHtml(e.from_email)}&gt;</div>
      <div class="meta-block"><strong>Subject</strong> ${escapeHtml(e.subject || '')}</div>
      <div class="meta-block"><strong>Received</strong> ${fmtTime(e.received_at || e.created_at)}</div>
      <div class="panel__title" style="margin:0.75rem 0 0.35rem">Routing flags</div>
      <div class="tags">${tags}</div>
      <div class="panel__title" style="margin:1rem 0 0.35rem">Customer message</div>
      <p class="body-preview">${escapeHtml(e.body || '')}</p>`;

    let draft = e.draft || '';
    if (!draft) {
      try {
        const d = await apiJson('POST', '/draft', { emailId: e.id });
        draft = d.draft || '';
        e.draft = draft;
      } catch (err) {
        draft = '(Could not generate draft — check API logs and OpenAI configuration.)';
      }
    }
    originalDraftText = draft;
    rightEl.innerHTML = `
      <div class="draft-panel__head">
        <h2 class="draft-panel__title">Suggested reply</h2>
        <p class="draft-panel__hint">Edit below before sending. What you see is what the customer receives.</p>
      </div>
      <textarea id="review-draft" spellcheck="true">${escapeHtml(draft)}</textarea>
      <div class="draft-actions">
        <button class="btn btn-primary" type="button" id="btn-approve">Approve &amp; Send</button>
        <button class="btn btn-danger-outline" type="button" id="btn-escalate">Escalate</button>
        <button class="btn btn-ghost" type="button" id="btn-regen">Regenerate</button>
      </div>`;

    const ta = rightEl.querySelector('#review-draft');
    const approveBtn = rightEl.querySelector('#btn-approve');

    async function doApprove() {
      clearDraftError();
      const text = ta.value;
      approveBtn.disabled = true;
      const prevLabel = approveBtn.textContent;
      approveBtn.textContent = 'Sending…';
      try {
        await apiJson('POST', '/send', {
          emailId: e.id,
          draft: text,
          originalDraft: originalDraftText,
        });
        emails = emails.filter((x) => x.id !== e.id);
        reviewSelectedId = emails[0]?.id || null;
        renderList();
        if (reviewSelectedId) await renderDetail();
        else {
          centerEl.innerHTML = `<div class="empty-state empty-state--success">
            <div class="empty-state__title">Queue cleared</div>
            Nice work — there is nothing else waiting for review right now.
          </div>`;
          rightEl.innerHTML = '';
        }
        updateReviewBadge();
      } catch (err) {
        showDraftError(err.message || 'Send failed', doApprove);
      } finally {
        approveBtn.disabled = false;
        approveBtn.textContent = prevLabel;
      }
    }

    rightEl.querySelector('#btn-approve').addEventListener('click', () => {
      doApprove().catch(showError);
    });

    rightEl.querySelector('#btn-escalate').addEventListener('click', async () => {
      if (
        !window.confirm(
          'Escalate this thread? It will leave the queue and be marked escalated for your team to handle outside InboxPilot.'
        )
      ) {
        return;
      }
      clearDraftError();
      try {
        await apiJson('POST', `/emails/${e.id}/escalate`, {});
        emails = emails.filter((x) => x.id !== e.id);
        reviewSelectedId = emails[0]?.id || null;
        renderList();
        if (reviewSelectedId) await renderDetail();
        else {
          centerEl.innerHTML = `<div class="empty-state empty-state--success">
            <div class="empty-state__title">Nothing pending</div>
            Escalations are logged; the queue is empty for now.
          </div>`;
          rightEl.innerHTML = '';
        }
        updateReviewBadge();
      } catch (err) {
        showError(err);
      }
    });

    rightEl.querySelector('#btn-regen').addEventListener('click', async () => {
      const current = ta.value;
      if (current.trim() !== String(originalDraftText).trim()) {
        const ok = window.confirm(
          'Regenerate will replace the draft with a new AI suggestion. Discard your edits?'
        );
        if (!ok) return;
      }
      clearDraftError();
      const regBtn = rightEl.querySelector('#btn-regen');
      const prevR = regBtn.textContent;
      regBtn.disabled = true;
      regBtn.textContent = 'Regenerating…';
      try {
        const d = await apiJson('POST', '/draft', {
          emailId: e.id,
          regenerate: true,
          preservePrevious: true,
        });
        const next = d.draft || '';
        ta.value = next;
        originalDraftText = next;
        e.draft = next;
      } catch (err) {
        showError(err);
      } finally {
        regBtn.disabled = false;
        regBtn.textContent = prevR;
      }
    });
  }

  renderList();
  await renderDetail();
}

async function viewAutopilot(main) {
  main.innerHTML = `<div class="page-wrap">
    ${pageHeader(
      'Auto-Pilot Log',
      'Audit trail for AI-only sends — compare inbound context, classifier reasoning, and the exact customer-facing reply.'
    )}
    <div class="data-table-wrap" id="ap-list-wrap"><div class="sk-panel" style="margin:0;border-radius:0;border-left:none;border-right:none">${skeletonTableRows(7)}</div></div>
    <div id="ap-detail"></div>
  </div>`;
  let data = { emails: [] };
  try {
    data = await apiGet('/emails?track=auto&status=sent&limit=100');
  } catch (e) {
    main.insertAdjacentHTML(
      'afterbegin',
      `<div class="error-toast">${escapeHtml(e.message)}</div>`
    );
  }
  const wrap = main.querySelector('#ap-list-wrap');
  const detailEl = main.querySelector('#ap-detail');
  let selected = null;

  function render() {
    const emails = data.emails || [];
    if (!emails.length) {
      wrap.innerHTML = `<div class="empty-state" style="padding:2rem">
        <div class="empty-state__title">No Auto-Pilot sends recorded</div>
        When the classifier clears messages above your auto-send threshold (and Nylas sends successfully), each reply is listed here with full reasoning. Connect live mail or load seed data to see examples.
      </div>`;
      detailEl.innerHTML = '';
      return;
    }
    let rows = '';
    for (const e of emails) {
      const conf = e.confidence != null ? Number(e.confidence) : 0;
      rows += `<tr data-id="${e.id}" style="cursor:pointer">
        <td>
          <div class="email-cell__name">${escapeHtml(e.from_display_name || e.from_email)}</div>
          <div class="email-cell__sub">${escapeHtml(e.from_email || '')}</div>
        </td>
        <td><div class="email-cell__name" style="font-size:0.86rem">${escapeHtml(e.subject || '')}</div></td>
        <td>${confidenceBlock(conf)}</td>
        <td style="text-align:right;color:var(--muted);font-size:0.82rem">${fmtTime(e.sent_at || e.updated_at)}</td>
      </tr>`;
    }
    wrap.innerHTML = `<table class="data-table"><thead><tr>
      <th>Sender</th>
      <th>Subject</th>
      <th>Confidence</th>
      <th style="text-align:right">Sent</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
    wrap.querySelectorAll('tbody tr').forEach((tr) => {
      tr.addEventListener('click', () => {
        const id = parseInt(tr.getAttribute('data-id'), 10);
        selected = emails.find((x) => x.id === id);
        wrap.querySelectorAll('tbody tr').forEach((r) => r.classList.remove('row-selected'));
        tr.classList.add('row-selected');
        detail();
      });
    });
    detail();
  }

  function detail() {
    if (!selected) {
      detailEl.innerHTML =
        '<div class="empty-state" style="margin-top:1rem">Select a row to compare inbound content and the exact reply sent.</div>';
      return;
    }
    detailEl.innerHTML = `<div class="inbox-detail" style="margin-top:1rem">
      ${trustCardHtml(selected, 'auto')}
      <div class="ap-detail-grid">
        <div>
          <div class="panel__title" style="margin-bottom:0.5rem">Original inbound</div>
          <p class="body-preview" style="margin:0">${escapeHtml(selected.body || '')}</p>
        </div>
        <div>
          <div class="panel__title" style="margin-bottom:0.5rem">Reply sent to customer</div>
          <p class="body-preview" style="margin:0">${escapeHtml(selected.final_reply || selected.draft || '—')}</p>
        </div>
      </div>
    </div>`;
  }

  render();
}

async function viewKnowledge(main) {
  main.innerHTML = `<div class="page-wrap">
    ${pageHeader(
      'Knowledge Base',
      'Documents the AI can cite. Upload pricing sheets, policies, and FAQs — then confirm extracted entries on the right.'
    )}
    <div class="kb-layout">
      <div class="kb-files">
        <div id="kb-status-toast"></div>
        <div class="kb-drop" id="kb-drop" tabindex="0">
          <strong>Drop files here</strong> or use the file picker below.
          <div style="margin-top:0.5rem;font-size:0.8rem">PDF, CSV, TXT, MD · up to 10 MB</div>
        </div>
        <div id="kb-file-rows"></div>
        <div style="margin-top:0.5rem">
          <input type="file" id="kb-up" accept=".pdf,.csv,.txt,.md" />
        </div>
      </div>
      <div class="kb-preview" id="kb-preview"><div class="empty-state">
        <div class="empty-state__title">No file selected</div>
        Choose a file on the left to review parsed Q&amp;A-style chunks.
      </div></div>
    </div>
  </div>`;

  const rowsEl = main.querySelector('#kb-file-rows');
  rowsEl.innerHTML = `<div class="sk-panel" style="border:none;box-shadow:none;padding:0.5rem 0">${skeletonTableRows(4)}</div>`;

  let data = { files: [] };
  try {
    data = await apiGet('/knowledge/files');
  } catch (e) {
    rowsEl.innerHTML = '';
    main.querySelector('#kb-preview').innerHTML = `<div class="error-toast">${escapeHtml(e.message)}</div>`;
  }
  const prev = main.querySelector('#kb-preview');
  const drop = main.querySelector('#kb-drop');

  async function showPreview(id) {
    knowledgeSelectedFileId = id;
    rowsEl.querySelectorAll('.kb-file-row').forEach((r) => {
      r.classList.toggle('active', r.getAttribute('data-id') === String(id));
    });
    const p = await apiGet(`/knowledge/files/${id}/preview`);
    let html = `<h2 class="page-title" style="font-size:1.05rem;margin:0 0 0.5rem">${escapeHtml(p.file.filename)}</h2>
      <div style="font-size:0.82rem;color:var(--muted);margin-bottom:1rem">
        ${fmtBytes(p.file.file_size_bytes)} · ${p.file.chunk_count || 0} chunks · ${escapeHtml(p.file.processing_status || '')}
      </div>`;
    const entries = p.entries || [];
    if (p.file.processing_status === 'failed') {
      html += `<div class="error-toast">Processing failed for this file. Try re-uploading a cleaner export or a different format.</div>`;
    }
    if (!entries.length && p.file.processing_status === 'ready') {
      html += `<div class="empty-state">No Q&amp;A entries extracted yet — content may be unstructured.</div>`;
    }
    for (const q of entries) {
      html += `<div class="qa-block"><div class="qa-q">${escapeHtml(q.question)}</div><div class="qa-a">${escapeHtml(q.answer)}</div></div>`;
    }
    prev.innerHTML = html;
  }

  function renderFileList() {
    rowsEl.innerHTML = '';
    const files = data.files || [];
    if (!files.length) {
      rowsEl.innerHTML = `<div class="empty-state" style="padding:1rem 0">
        <div class="empty-state__title">Knowledge base is empty</div>
        Upload pricing, policies, and FAQs so replies stay on-brand and accurate.
      </div>`;
      return;
    }
    for (const f of files) {
      const row = document.createElement('div');
      row.className = 'kb-file-row';
      row.setAttribute('data-id', String(f.id));
      if (knowledgeSelectedFileId === f.id) row.classList.add('active');
      const st = f.processing_status || 'ready';
      row.innerHTML = `
        <div>
          <div style="font-weight:600;font-size:0.88rem">${escapeHtml(f.filename)}</div>
          <div style="font-size:0.78rem;color:var(--muted);margin-top:0.2rem">
            ${fmtBytes(f.file_size_bytes)} · ${fmtTime(f.created_at)}
          </div>
        </div>
        <div style="text-align:right">
          <span class="${kbStatusClass(st)}">${escapeHtml(st)}</span>
          <div style="font-size:0.75rem;color:var(--muted);margin-top:0.25rem">${f.chunk_count ?? 0} entries</div>
        </div>`;
      row.addEventListener('click', () => {
        showPreview(f.id).catch((e) => {
          prev.innerHTML = `<div class="error-toast">${escapeHtml(e.message)}</div>`;
        });
      });
      rowsEl.appendChild(row);
    }
  }

  renderFileList();

  if (data.files?.length && !knowledgeSelectedFileId) {
    knowledgeSelectedFileId = data.files[0].id;
    await showPreview(knowledgeSelectedFileId).catch(() => {});
    renderFileList();
  }

  async function uploadFile(file) {
    if (!file) return;
    const toast = main.querySelector('#kb-status-toast');
    if (toast) {
      toast.innerHTML =
        '<div class="toast-success" style="margin-bottom:0.75rem">Uploading and parsing…</div>';
    }
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_BASE}/knowledge/upload`, {
      method: 'POST',
      headers: tenantHeaders(),
      body: fd,
    });
    const out = await res.json().catch(() => ({}));
    const body = unwrapApiBody(out, res);
    drop.classList.remove('kb-drop--active');
    const newId = body.file?.id;
    data = await apiGet('/knowledge/files');
    renderFileList();
    if (newId) {
      knowledgeSelectedFileId = newId;
      await showPreview(newId).catch((err) => {
        prev.innerHTML = `<div class="error-toast">${escapeHtml(err.message)}</div>`;
      });
    }
    if (toast) {
      toast.innerHTML = `<div class="toast-success" style="margin-bottom:0.75rem">File ingested — ${escapeHtml(body.file?.filename || 'upload')} is ready to preview.</div>`;
      setTimeout(() => {
        if (toast) toast.innerHTML = '';
      }, 5000);
    }
    updateSystemStatus().catch(() => {});
  }

  main.querySelector('#kb-up').addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    try {
      await uploadFile(file);
    } catch (e) {
      const t = main.querySelector('#kb-status-toast');
      if (t) t.innerHTML = '';
      showError(e);
    }
    ev.target.value = '';
  });

  ['dragenter', 'dragover'].forEach((ev) => {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('kb-drop--active');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === 'drop') {
        const f = e.dataTransfer?.files?.[0];
        uploadFile(f).catch((err) => {
          const t = main.querySelector('#kb-status-toast');
          if (t) t.innerHTML = '';
          showError(err);
        });
      }
      drop.classList.remove('kb-drop--active');
    });
  });
}

async function viewSettings(main) {
  let s;
  try {
    s = await apiGet('/settings');
  } catch (e) {
    main.innerHTML = `<div class="page-wrap"><div class="error-toast">${escapeHtml(e.message)}</div></div>`;
    return;
  }
  const thr0 = s.autoSendThreshold ?? 0.9;
  main.innerHTML = `<div class="page-wrap">
    ${pageHeader(
      'Settings',
      'Operational controls for inbox connection, the AI engine, and automation rules.'
    )}
    <div id="settings-banner"></div>
    <div id="settings-err"></div>
    <div class="settings-grid">
      <div class="settings-card">
        <h3>Email connection</h3>
        <p class="hint">This is the address operators see in the sidebar. Live send/receive requires Nylas credentials and a grant in your server environment — not in this form.</p>
        <div class="status-pill-ok" id="conn-status" style="display:none">
          <span class="dot live" style="margin-top:0"></span> Nylas configured on server
        </div>
        <div class="error-toast" id="conn-warn" style="display:${s.nylasConfigured ? 'none' : 'block'};margin-bottom:0.85rem;font-size:0.82rem;padding:0.55rem 0.75rem">
          Inbound/outbound mail is paused until <code class="code-inline">NYLAS_API_KEY</code> and <code class="code-inline">NYLAS_GRANT_ID</code> are set. This UI is still fully usable for review, KB, and settings.
        </div>
        <div class="form-row">
          <label>Business email</label>
          <input type="email" id="set-email" style="width:100%" value="${escapeHtml(s.businessEmail || '')}" />
        </div>
        <div class="form-row">
          <label>Provider</label>
          <select id="set-provider" style="width:100%">
            <option value="">—</option>
            <option value="gmail">Gmail</option>
            <option value="outlook">Outlook</option>
          </select>
        </div>
        <button class="btn" type="button" id="set-save-conn">Save connection</button>
      </div>
      <div class="settings-card">
        <h3>AI engine</h3>
        <p class="hint">The model runs on your infrastructure. Set <code class="code-inline">OPENAI_API_KEY</code> in the server environment — keys are never stored through this dashboard.</p>
        <div class="status-pill-ok" id="ai-status-ok" style="display:${s.openAiKeyConfigured ? 'inline-flex' : 'none'};margin-bottom:0.75rem">
          <span class="dot live" style="margin-top:0"></span> OpenAI reachable from server
        </div>
        <div class="error-toast" id="ai-status-warn" style="display:${s.openAiKeyConfigured ? 'none' : 'block'};margin-bottom:0.85rem;font-size:0.82rem;padding:0.55rem 0.75rem">
          Drafting and classification need an API key on the server. Add <code class="code-inline">OPENAI_API_KEY</code>, restart the API, then refresh this page.
        </div>
        <div class="form-row">
          <label>Model label</label>
          <input type="text" id="set-model" style="width:100%" value="${escapeHtml(s.displayModel || 'gpt-4o')}" />
        </div>
        <div class="form-row">
          <label>Auto-send threshold: <strong id="thr-lbl">${Math.round(thr0 * 100)}%</strong></label>
          <input type="range" id="set-threshold" min="0.5" max="1" step="0.01" value="${thr0}" style="width:100%" />
          <div class="page-desc" style="margin-top:0.35rem;font-size:0.8rem">Higher values are safer: only very confident classifications auto-send.</div>
        </div>
      </div>
      <div class="settings-card">
        <h3>Automation rules</h3>
        <p class="hint">These toggles change how messages are classified and drafted.</p>
        <div class="toggle-row">
          <input type="checkbox" id="t-auto" />
          <span>Auto-send high-confidence replies <small>When off, more mail may require review.</small></span>
        </div>
        <div class="toggle-row">
          <input type="checkbox" id="t-discount" />
          <span>Always flag discount requests <small>Sends ambiguous pricing asks to Human Loop.</small></span>
        </div>
        <div class="toggle-row">
          <input type="checkbox" id="t-rag" />
          <span>RAG-only mode <small>Strict knowledge-base grounding when generating drafts.</small></span>
        </div>
        <div class="toggle-row">
          <input type="checkbox" id="t-feedback" />
          <span>Feedback loop learning <small>Record human edits to improve future suggestions.</small></span>
        </div>
        <button class="btn btn-primary" type="button" id="set-save-all" style="margin-top:1rem">Save all settings</button>
      </div>
    </div>
  </div>`;

  const prov = main.querySelector('#set-provider');
  if (s.provider) prov.value = s.provider;
  main.querySelector('#t-auto').checked =
    s.settings?.autoSendHighConfidence !== false;
  main.querySelector('#t-discount').checked =
    Boolean(s.settings?.alwaysFlagDiscountRequests);
  main.querySelector('#t-rag').checked = s.settings?.ragOnlyMode !== false;
  main.querySelector('#t-feedback').checked =
    s.settings?.feedbackLoopLearning !== false;

  if (s.nylasConfigured) {
    const cs = main.querySelector('#conn-status');
    if (cs) cs.style.display = 'inline-flex';
  }

  const banner = main.querySelector('#settings-banner');
  const inputs = main.querySelectorAll(
    'input, select, textarea, #set-threshold'
  );

  function snapshot() {
    return JSON.stringify({
      email: main.querySelector('#set-email').value,
      provider: main.querySelector('#set-provider').value,
      model: main.querySelector('#set-model').value,
      thr: main.querySelector('#set-threshold').value,
      tAuto: main.querySelector('#t-auto').checked,
      tDisc: main.querySelector('#t-discount').checked,
      tRag: main.querySelector('#t-rag').checked,
      tFb: main.querySelector('#t-feedback').checked,
    });
  }

  let baseline = snapshot();

  function refreshDirty() {
    const dirty = snapshot() !== baseline;
    banner.innerHTML = dirty
      ? '<div class="unsaved-banner">You have unsaved changes — click Save to apply.</div>'
      : '';
  }

  inputs.forEach((el) => {
    el.addEventListener('input', refreshDirty);
    el.addEventListener('change', refreshDirty);
  });

  const thr = main.querySelector('#set-threshold');
  const thrl = main.querySelector('#thr-lbl');
  thr.addEventListener('input', () => {
    thrl.textContent = `${Math.round(Number(thr.value) * 100)}%`;
  });

  async function saveAll() {
    try {
      await apiJson('PUT', '/settings', {
        businessEmail: main.querySelector('#set-email').value || null,
        provider: main.querySelector('#set-provider').value || null,
        displayModel: main.querySelector('#set-model').value || 'gpt-4o',
        autoSendThreshold: Number(main.querySelector('#set-threshold').value),
        settings: {
          autoSendHighConfidence: main.querySelector('#t-auto').checked,
          alwaysFlagDiscountRequests: main.querySelector('#t-discount').checked,
          ragOnlyMode: main.querySelector('#t-rag').checked,
          feedbackLoopLearning: main.querySelector('#t-feedback').checked,
        },
      });
      baseline = snapshot();
      refreshDirty();
      localStorage.setItem('inboxpilot_seen_threshold', '1');
      main.querySelector('#settings-err').innerHTML =
        '<div class="toast-success">Settings saved — applied on the server for this tenant.</div>';
      setTimeout(() => {
        main.querySelector('#settings-err').innerHTML = '';
      }, 2800);
      updateSystemStatus().catch(() => {});
    } catch (e) {
      main.querySelector('#settings-err').innerHTML = `<div class="error-toast">${escapeHtml(e.message)}</div>`;
    }
  }

  main.querySelector('#set-save-conn').addEventListener('click', saveAll);
  main.querySelector('#set-save-all').addEventListener('click', saveAll);
}

async function render() {
  const main = document.getElementById('main');
  const route = parseRoute();

  if (hasSession() && route.name === 'signin') {
    window.location.hash = '#/dashboard';
    return;
  }

  if (!hasSession()) {
    document.body.classList.add('ip-guest');
    const rib = document.getElementById('main-ribbon');
    if (rib) rib.hidden = true;
    if (route.name !== 'signin') {
      window.location.hash = '#/signin';
    }
    viewSignIn(main);
    document.querySelectorAll('.nav a').forEach((a) => a.classList.remove('active'));
    return;
  }

  document.body.classList.remove('ip-guest');
  const rib = document.getElementById('main-ribbon');
  if (rib) rib.hidden = false;
  syncRibbon();

  setActiveNav(route.name === 'dashboard' ? 'dashboard' : route.name);

  try {
    if (route.name === 'dashboard' || route.name === '') {
      await viewDashboard(main);
    } else if (route.name === 'inbox') {
      await viewInbox(main);
    } else if (route.name === 'review') {
      await viewReview(main, route);
    } else if (route.name === 'autopilot') {
      await viewAutopilot(main);
    } else if (route.name === 'knowledge') {
      await viewKnowledge(main);
    } else if (route.name === 'settings') {
      await viewSettings(main);
    } else {
      main.innerHTML =
        '<div class="page-wrap"><h1 class="page-title">Not found</h1></div>';
    }
  } catch (e) {
    main.innerHTML = `<div class="page-wrap"><div class="error-toast">${escapeHtml(e.message)}</div></div>`;
  }

  await updateReviewBadge();
  updateSystemStatus().catch(() => {});
}

window.addEventListener('hashchange', () => {
  render().catch(console.error);
});

(async function init() {
  await updateSystemStatus();
  await render();
})();
