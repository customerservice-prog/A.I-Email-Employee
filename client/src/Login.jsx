import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

async function postGoogleCredential(credential) {
  const r = await fetch('/api/auth/google', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) {
    throw new Error(j.error?.message || `Sign-in failed (${r.status})`);
  }
  return j.data;
}

async function postPasswordLogin(email, password) {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) {
    throw new Error(j.error?.message || `Sign-in failed (${r.status})`);
  }
  return j.data;
}

async function finishSignInNavigate(navigate, next) {
  const r = await fetch('/api/auth/me', { credentials: 'include' });
  const j = await r.json().catch(() => ({}));
  if (!j.success) {
    throw new Error('Session could not be loaded after sign-in.');
  }
  const nylasReady = Boolean(j.data?.nylas?.grantConfigured);
  if (next === 'nylas') {
    navigate('/connect', { replace: true });
    return;
  }
  if (!nylasReady) {
    navigate('/connect', { replace: true });
    return;
  }
  navigate('/', { replace: true });
}

export default function Login() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const next = search.get('next') || '';
  const btnRef = useRef(null);
  const [err, setErr] = useState('');
  const [opts, setOpts] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/options')
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.success && j.data) setOpts(j.data);
        else setOpts({});
      })
      .catch(() => {
        if (!cancelled) setOpts({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;
    const existing = document.querySelector('script[data-inboxpilot-gis]');
    const script = existing || document.createElement('script');
    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.inboxpilotGis = '1';
      document.body.appendChild(script);
    }
    const onLoad = () => {
      if (cancelled || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (resp) => {
          try {
            setErr('');
            const cred = resp.credential;
            if (!cred) throw new Error('No credential from Google');
            const data = await postGoogleCredential(cred);
            const nylasReady = Boolean(data.nylas?.grantConfigured);
            if (next === 'nylas') {
              navigate('/connect', { replace: true });
              return;
            }
            if (!nylasReady) {
              navigate('/connect', { replace: true });
              return;
            }
            navigate('/', { replace: true });
          } catch (e) {
            setErr(e.message || 'Sign-in failed');
          }
        },
        auto_select: true,
        cancel_on_tap_outside: false,
      });
      try {
        window.google.accounts.id.prompt();
      } catch {
        /* FedCM / browser quirks */
      }
      if (btnRef.current) {
        window.google.accounts.id.renderButton(btnRef.current, {
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          width: 280,
        });
      }
    };
    if (window.google?.accounts?.id) {
      onLoad();
    } else {
      script.addEventListener('load', onLoad);
    }
    return () => {
      cancelled = true;
      script.removeEventListener('load', onLoad);
    };
  }, [clientId, navigate, next]);

  async function onPasswordSubmit(e) {
    e.preventDefault();
    setErr('');
    setPwBusy(true);
    try {
      await postPasswordLogin(email.trim(), password);
      await finishSignInNavigate(navigate, next);
    } catch (subErr) {
      setErr(subErr.message || 'Sign-in failed');
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand" style={{ marginBottom: 24, fontSize: '1.25rem' }}>
          <span>✉</span> InboxPilot
        </div>
        <h1 className="page-title" style={{ marginBottom: 8 }}>
          Sign in
        </h1>
        <p className="page-desc" style={{ marginBottom: 20 }}>
          Prefer Google for the mailbox you will connect through Nylas. You can also sign in with
          the email and password for your workspace account below.
        </p>
        {!clientId ? (
          <div
            className="error"
            style={{ marginBottom: 16, fontSize: '0.9rem' }}
          >
            Google sign-in: copy <code>client/.env.example</code> to <code>client/.env.local</code>,
            set <code>VITE_GOOGLE_CLIENT_ID</code> (same Web client ID as server{' '}
            <code>GOOGLE_CLIENT_ID</code>), then restart <code>npm run client:dev</code>. Email and
            password still works without it.
          </div>
        ) : null}
        {clientId && opts && !opts.googleSignInConfigured ? (
          <div className="error">
            Server is missing <code>GOOGLE_CLIENT_ID</code> in the root <code>.env</code>. Restart
            the API after adding it.
          </div>
        ) : null}
        {opts && !opts.nylasConnectConfigured ? (
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 12 }}>
            Tip: set <code>NYLAS_CLIENT_ID</code> and <code>NYLAS_API_KEY</code> on the server to
            enable “Connect Gmail” after sign-in.
          </p>
        ) : null}
        {err ? <div className="error" style={{ marginBottom: 12 }}>{err}</div> : null}
        {clientId ? (
          <>
            <div ref={btnRef} style={{ minHeight: 44 }} />
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 12 }}>
              If you are already signed into Google in this browser, you may see a one-tap prompt
              above. Otherwise use the button.
            </p>
          </>
        ) : null}

        <div
          style={{
            margin: '24px 0',
            borderTop: '1px solid var(--border, #e5e7eb)',
            paddingTop: 20,
          }}
        >
          <h2 className="page-desc" style={{ marginBottom: 12, fontWeight: 600 }}>
            Email and password
          </h2>
          <form onSubmit={onPasswordSubmit}>
            <label className="page-desc" style={{ display: 'block', marginBottom: 6 }}>
              Email
              <input
                type="email"
                name="email"
                autoComplete="username"
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
            <label className="page-desc" style={{ display: 'block', marginBottom: 16 }}>
              Password
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
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
            <button
              type="submit"
              className="btn btn-primary"
              disabled={pwBusy}
              style={{ width: '100%' }}
            >
              {pwBusy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: 12 }}>
            Run <code>npm run db:seed-test-users</code> to create ten demo accounts (
            <code>testuser1@inboxpilot.test</code> … <code>testuser10@inboxpilot.test</code>, default
            password <code>TestPass123!</code>).
          </p>
        </div>
      </div>
    </div>
  );
}
