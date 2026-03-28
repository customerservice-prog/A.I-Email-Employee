import { useEffect, useState, useCallback } from 'react';
import {
  NavLink,
  Routes,
  Route,
  Outlet,
  useNavigate,
  useSearchParams,
  Navigate,
} from 'react-router-dom';
import { apiGet, apiJson, getApiHeaders, uploadKb } from './api';
import Login from './Login.jsx';
import Connect from './Connect.jsx';
import Register from './Register.jsx';

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
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

function Layout({ children, pending, footerEmail, model, live, onSignOut }) {
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand">
          <span>✉</span> InboxPilot
        </div>
        <nav className="nav">
          <NavLink end className={({ isActive }) => (isActive ? 'active' : '')} to="/">
            Dashboard
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/inbox">
            Inbox Feed
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/review">
            Review Queue
            {pending > 0 ? <span className="badge">{pending}</span> : null}
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/autopilot">
            Auto-Pilot Log
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/knowledge">
            Knowledge Base
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/settings">
            Settings
          </NavLink>
        </nav>
        <footer className="sidebar-footer">
          <div>
            <span className="dot" style={{ opacity: live ? 1 : 0.4 }} />
            {footerEmail}
          </div>
          <div style={{ marginTop: 6 }}>{model}</div>
          {onSignOut ? (
            <button
              type="button"
              className="btn"
              style={{ marginTop: 10, fontSize: '0.75rem', width: '100%' }}
              onClick={onSignOut}
            >
              Sign out
            </button>
          ) : null}
        </footer>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

function Dashboard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    apiGet('/api/stats')
      .then(setD)
      .catch((e) => setErr(e.message));
  }, []);
  if (err) return <div className="error">{err}</div>;
  if (!d) return <p className="page-desc">Loading…</p>;
  const p = d.pendingReview || 0;
  return (
    <>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-desc">Operational overview for your inbox triage.</p>
      <div className="grid-stats">
        <div className="stat-card">
          <div className="stat-label">Emails today</div>
          <div className="stat-value">{d.emailsToday}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Auto-Pilot sent</div>
          <div className="stat-value">{d.autoPilotSentToday}</div>
        </div>
        <div className={`stat-card${p > 0 ? ' alert' : ''}`}>
          <div className="stat-label">Pending review</div>
          <div className="stat-value">{p}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg confidence (7d)</div>
          <div className="stat-value">
            {d.avgConfidence7d != null ? fmtPct(d.avgConfidence7d) : '—'}
          </div>
        </div>
      </div>
      <div className="two-col">
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Recent emails</h3>
          {(d.recentEmails || []).map((e) => (
            <div key={e.id} className="email-row">
              <div>
                <div>{e.from_display_name || e.from_email}</div>
                <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                  {e.subject || '(no subject)'}
                </div>
              </div>
              <span className={`pill ${e.track === 'auto' ? 'auto' : 'review'}`}>
                {e.track === 'auto' ? 'Auto' : 'Review'}
              </span>
              <div className="conf-bar">
                <span
                  style={{
                    width: `${Math.min(100, Math.round((e.confidence || 0) * 100))}%`,
                  }}
                />
              </div>
              <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                {fmtTime(e.received_at || e.created_at)}
              </span>
            </div>
          ))}
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Activity feed</h3>
          {(d.activity || []).map((a) => (
            <div key={a.id} className="email-row" style={{ gridTemplateColumns: '1fr 100px' }}>
              <span>
                Sent · <strong>{a.subject || a.from_email || 'message'}</strong>
              </span>
              <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                {fmtTime(a.created_at)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Inbox() {
  const [rows, setRows] = useState([]);
  const [track, setTrack] = useState('');
  const [status, setStatus] = useState('');
  const navigate = useNavigate();
  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (track) q.set('track', track);
    if (status) q.set('status', status);
    const qs = q.toString();
    apiGet(`/api/emails${qs ? `?${qs}` : ''}`).then((d) => setRows(d.emails || []));
  }, [track, status]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <>
      <h1 className="page-title">Inbox Feed</h1>
      <p className="page-desc">All inbound messages.</p>
      <div className="panel" style={{ marginBottom: 12 }}>
        <label>
          Track{' '}
          <select value={track} onChange={(e) => setTrack(e.target.value)}>
            <option value="">All</option>
            <option value="auto">Auto-Pilot</option>
            <option value="review">Human Loop</option>
          </select>
        </label>{' '}
        <label style={{ marginLeft: 12 }}>
          Status{' '}
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="sent">Sent</option>
            <option value="escalated">Escalated</option>
            <option value="failed">Failed</option>
          </select>
        </label>{' '}
        <button type="button" className="btn" onClick={load}>
          Refresh
        </button>
      </div>
      <div className="panel">
        {rows.map((e) => (
          <div
            key={e.id}
            className="email-row"
            style={{ cursor: e.track === 'review' && e.status === 'pending' ? 'pointer' : 'default' }}
            onClick={() => {
              if (e.track === 'review' && e.status === 'pending') {
                navigate(`/review?id=${e.id}`);
              }
            }}
          >
            <div>
              <div>{e.from_display_name || e.from_email}</div>
              <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{e.subject}</div>
            </div>
            <span className={`pill ${e.track === 'auto' ? 'auto' : 'review'}`}>
              {e.track === 'auto' ? 'Auto' : 'Review'}
            </span>
            <span>{fmtPct(e.confidence)}</span>
            <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
              {fmtTime(e.received_at || e.created_at)}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function Review() {
  const [search] = useSearchParams();
  const preId = search.get('id');
  const [queue, setQueue] = useState([]);
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');

  const loadQueue = useCallback(() => {
    apiGet('/api/emails?status=pending&track=review')
      .then((d) => {
        const emails = d.emails || [];
        setQueue(emails);
        if (emails.length) {
          const pick = preId
            ? emails.find((x) => String(x.id) === String(preId)) || emails[0]
            : emails[0];
          setSel(pick);
          setDraft(pick.draft || '');
        } else {
          setSel(null);
          setDraft('');
        }
      })
      .catch((e) => setErr(e.message));
  }, [preId]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (sel) setDraft(sel.draft || '');
  }, [sel?.id]);

  const flags = Array.isArray(sel?.flags) ? sel.flags : [];

  return (
    <>
      <h1 className="page-title">Review Queue</h1>
      <p className="page-desc">Approve, edit, or escalate customer replies.</p>
      {err ? <div className="error">{err}</div> : null}
      <div className="review-layout">
        <div className="panel" style={{ padding: 0 }}>
          {queue.map((e) => (
            <button
              key={e.id}
              type="button"
              className={`review-list-item${sel?.id === e.id ? ' active' : ''}`}
              onClick={() => setSel(e)}
            >
              <div>{e.from_display_name || e.from_email}</div>
              <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{e.subject}</div>
              <div className="conf">{fmtPct(e.confidence)} confidence</div>
            </button>
          ))}
          {!queue.length ? <p style={{ padding: 16 }}>Queue is empty.</p> : null}
        </div>
        <div className="panel">
          {sel ? (
            <>
              <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                <div>
                  <strong>From</strong> {sel.from_display_name} &lt;{sel.from_email}&gt;
                </div>
                <div>
                  <strong>Subject</strong> {sel.subject}
                </div>
                <div>
                  <strong>Received</strong> {fmtTime(sel.received_at || sel.created_at)}
                </div>
              </div>
              <div style={{ margin: '12px 0' }}>
                {flags.length ? (
                  flags.map((f) => (
                    <span key={f} className="tag">
                      {f}
                    </span>
                  ))
                ) : (
                  <span className="tag">No flags</span>
                )}
              </div>
              <div className="body-text">{sel.body_cleaned || sel.body_raw || sel.body || ''}</div>
            </>
          ) : (
            <p>Select an email</p>
          )}
        </div>
        <div className="panel">
          {sel ? (
            <>
              <h3 style={{ marginTop: 0 }}>AI draft</h3>
              <textarea className="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
              <div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    try {
                      await apiJson('POST', '/api/send', {
                        emailId: sel.id,
                        draft,
                        originalDraft: sel.draft,
                      });
                      loadQueue();
                    } catch (e) {
                      setErr(e.message);
                    }
                  }}
                >
                  Approve &amp; Send
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={async () => {
                    try {
                      await apiJson('POST', `/api/emails/${sel.id}/escalate`, {});
                      loadQueue();
                    } catch (e) {
                      setErr(e.message);
                    }
                  }}
                >
                  Escalate
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    try {
                      const out = await apiJson('POST', '/api/draft', {
                        emailId: sel.id,
                        preservePrevious: true,
                      });
                      setDraft(out.draft || '');
                      loadQueue();
                    } catch (e) {
                      setErr(e.message);
                    }
                  }}
                >
                  Regenerate
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Autopilot() {
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(null);
  useEffect(() => {
    apiGet('/api/emails?track=auto&status=sent').then((d) => setRows(d.emails || []));
  }, []);
  return (
    <>
      <h1 className="page-title">Auto-Pilot Log</h1>
      <p className="page-desc">Automatically sent replies for audit.</p>
      <div className="panel">
        {rows.map((e) => (
          <div
            key={e.id}
            className="email-row"
            style={{ gridTemplateColumns: '1fr 80px 100px', cursor: 'pointer' }}
            onClick={() => setSel(e)}
          >
            <div>
              <div>{e.from_display_name || e.from_email}</div>
              <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{e.subject}</div>
            </div>
            <span>{fmtPct(e.confidence)}</span>
            <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
              {fmtTime(e.sent_at || e.updated_at)}
            </span>
          </div>
        ))}
      </div>
      {sel ? (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Detail</h3>
          <p className="body-text">
            <strong>Customer</strong>
            {'\n'}
            {sel.body_cleaned || sel.body_raw || ''}
          </p>
          <p className="body-text">
            <strong>Reply sent</strong>
            {'\n'}
            {sel.final_reply || sel.draft || ''}
          </p>
        </div>
      ) : null}
    </>
  );
}

function Knowledge() {
  const [files, setFiles] = useState([]);
  const [sel, setSel] = useState(null);
  const [preview, setPreview] = useState(null);
  const load = () => apiGet('/api/knowledge/files').then((d) => setFiles(d.files || []));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!sel) {
      setPreview(null);
      return;
    }
    apiGet(`/api/knowledge/files/${sel.id}/preview`)
      .then(setPreview)
      .catch(() => setPreview(null));
  }, [sel]);
  return (
    <>
      <h1 className="page-title">Knowledge Base</h1>
      <p className="page-desc">Uploaded documents chunked for RAG.</p>
      <div className="kb-layout">
        <div className="panel kb-files">
          <ul style={{ padding: 0, margin: 0 }}>
            {files.map((f) => (
              <li
                key={f.id}
                className={sel?.id === f.id ? 'active' : ''}
                onClick={() => setSel(f)}
              >
                {f.filename} · {f.chunk_count} entries · {f.processing_status}
              </li>
            ))}
          </ul>
          <input
            type="file"
            accept=".pdf,.csv,.txt,.md"
            style={{ marginTop: 12 }}
            onChange={async (ev) => {
              const f = ev.target.files?.[0];
              if (!f) return;
              await uploadKb(f);
              load();
              ev.target.value = '';
            }}
          />
        </div>
        <div className="panel">
          {preview ? (
            <>
              <h3 style={{ marginTop: 0 }}>{preview.file.filename}</h3>
              {(preview.entries || []).map((q) => (
                <div key={q.chunkIndex} style={{ marginBottom: 16, borderBottom: '1px solid #e2e8f0', paddingBottom: 12 }}>
                  <strong>{q.question}</strong>
                  <div className="body-text">{q.answer}</div>
                </div>
              ))}
            </>
          ) : (
            <p>Select a file</p>
          )}
        </div>
      </div>
    </>
  );
}

function SettingsView() {
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    apiGet('/api/settings').then(setS);
  }, []);
  if (!s) return <p>Loading…</p>;
  return (
    <>
      <h1 className="page-title">Settings</h1>
      <p className="page-desc">Persisted per tenant in PostgreSQL.</p>
      {msg ? <div className="error" style={{ background: '#ecfdf5', borderColor: '#86efac', color: '#166534' }}>{msg}</div> : null}
      <div className="settings-grid">
        <div className="panel">
          <h3>Email connection</h3>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
            Prefer signing in with Google and using{' '}
            <a href="/connect">Connect inbox</a> (Nylas OAuth). Legacy single-mailbox: set{' '}
            <code className="code-inline">NYLAS_GRANT_ID</code> for tenant <code className="code-inline">default</code>.
          </p>
          <input
            placeholder="Business email"
            defaultValue={s.businessEmail || ''}
            id="be"
          />
          <select defaultValue={s.provider || ''} id="pv" style={{ marginTop: 8 }}>
            <option value="">Provider</option>
            <option value="gmail">Gmail</option>
            <option value="outlook">Outlook</option>
          </select>
        </div>
        <div className="panel">
          <h3>AI engine</h3>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
            API key from environment ({s.openAiKeyConfigured ? 'set' : 'missing'}).
          </p>
          <input placeholder="Model" defaultValue={s.displayModel || 'gpt-4o'} id="md" />
          <input
            type="range"
            min="0.5"
            max="1"
            step="0.01"
            defaultValue={s.autoSendThreshold ?? 0.9}
            id="th"
            style={{ width: '100%', marginTop: 8 }}
          />
        </div>
        <div className="panel">
          <h3>Automation rules</h3>
          <label className="toggle">
            <input type="checkbox" defaultChecked={s.settings?.autoSendHighConfidence !== false} id="t1" />
            Auto-send high-confidence
          </label>
          <label className="toggle">
            <input type="checkbox" defaultChecked={s.settings?.alwaysFlagDiscountRequests} id="t2" />
            Flag discount language
          </label>
          <label className="toggle">
            <input type="checkbox" defaultChecked={s.settings?.ragOnlyMode !== false} id="t3" />
            RAG-only mode
          </label>
          <label className="toggle">
            <input type="checkbox" defaultChecked={s.settings?.feedbackLoopLearning !== false} id="t4" />
            Feedback loop
          </label>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 12 }}
            onClick={async () => {
              const out = await apiJson('PUT', '/api/settings', {
                businessEmail: document.getElementById('be').value || null,
                provider: document.getElementById('pv').value || null,
                displayModel: document.getElementById('md').value,
                autoSendThreshold: Number(document.getElementById('th').value),
                settings: {
                  autoSendHighConfidence: document.getElementById('t1').checked,
                  alwaysFlagDiscountRequests: document.getElementById('t2').checked,
                  ragOnlyMode: document.getElementById('t3').checked,
                  feedbackLoopLearning: document.getElementById('t4').checked,
                },
              });
              setS(out);
              setMsg('Saved.');
              setTimeout(() => setMsg(''), 2000);
            }}
          >
            Save
          </button>
        </div>
      </div>
    </>
  );
}

function RequireAuth() {
  const [ok, setOk] = useState(null);
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include', headers: getApiHeaders() })
      .then((r) => r.json())
      .then((j) => setOk(Boolean(j.success)))
      .catch(() => setOk(false));
  }, []);
  if (ok === null) {
    return <p className="page-desc" style={{ padding: 48 }}>Loading…</p>;
  }
  if (!ok) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

function AppLayout() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(0);
  const [footerEmail, setFooterEmail] = useState('—');
  const [model, setModel] = useState('gpt-4o');
  const [live, setLive] = useState(false);

  useEffect(() => {
    fetch('/health')
      .then((r) => setLive(r.ok))
      .catch(() => setLive(false));
    apiGet('/api/stats')
      .then((d) => setPending(d.pendingReview || 0))
      .catch(() => {});
    apiGet('/api/settings')
      .then((s) => {
        setFooterEmail(s.businessEmail || 'Not connected');
        setModel(s.displayModel || 'gpt-4o');
      })
      .catch(() => {});
  }, []);

  const onSignOut = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    navigate('/login', { replace: true });
  }, [navigate]);

  return (
    <Layout
      pending={pending}
      footerEmail={footerEmail}
      model={model}
      live={live}
      onSignOut={onSignOut}
    >
      <Outlet />
    </Layout>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/connect" element={<Connect />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/review" element={<Review />} />
          <Route path="/autopilot" element={<Autopilot />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/settings" element={<SettingsView />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
