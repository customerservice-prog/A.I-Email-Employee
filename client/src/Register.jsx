import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getApiHeaders } from './api.js';

export default function Register() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setErr('');
    if (password.length < 10) {
      setErr('Password must be at least 10 characters.');
      return;
    }
    if (password !== confirm) {
      setErr('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/auth/register', {
        method: 'POST',
        credentials: 'include',
        headers: getApiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) {
        const msg = j.error?.message || `Registration failed (${r.status})`;
        throw new Error(msg);
      }
      navigate('/connect', { replace: true });
    } catch (sub) {
      setErr(sub.message || 'Registration failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand" style={{ marginBottom: 24, fontSize: '1.25rem' }}>
          <span>✉</span> InboxPilot
        </div>
        <h1 className="page-title" style={{ marginBottom: 8 }}>
          Create your workspace
        </h1>
        <p className="page-desc" style={{ marginBottom: 20 }}>
          One account per business. After signing up, connect your inbox with Nylas so inbound mail
          appears in the review queue.
        </p>
        {err ? <div className="error" style={{ marginBottom: 12 }}>{err}</div> : null}
        <form onSubmit={onSubmit}>
          <label className="page-desc" style={{ display: 'block', marginBottom: 6 }}>
            Work email
            <input
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              required
              className="input"
              style={{
                display: 'block',
                width: '100%',
                marginTop: 6,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border, #d1d5db)',
                boxSizing: 'border-box',
              }}
            />
          </label>
          <label className="page-desc" style={{ display: 'block', marginBottom: 6 }}>
            Password (10+ characters)
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              required
              minLength={10}
              className="input"
              style={{
                display: 'block',
                width: '100%',
                marginTop: 6,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border, #d1d5db)',
                boxSizing: 'border-box',
              }}
            />
          </label>
          <label className="page-desc" style={{ display: 'block', marginBottom: 16 }}>
            Confirm password
            <input
              type="password"
              name="confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(ev) => setConfirm(ev.target.value)}
              required
              minLength={10}
              className="input"
              style={{
                display: 'block',
                width: '100%',
                marginTop: 6,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border, #d1d5db)',
                boxSizing: 'border-box',
              }}
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy}
            style={{ width: '100%' }}
          >
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 16 }}>
          If your server uses <code>INBOXPILOT_API_SECRET</code>, set{' '}
          <code>VITE_INBOXPILOT_API_SECRET</code> to the same value in{' '}
          <code>client/.env.local</code> and restart the dev server.
        </p>
        <p style={{ marginTop: 12 }}>
          <Link to="/login">Already have an account? Sign in</Link>
        </p>
      </div>
    </div>
  );
}
