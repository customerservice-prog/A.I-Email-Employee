import { useEffect, useState } from 'react';
import { useSearchParams, Link, Navigate } from 'react-router-dom';

export default function Connect() {
  const [search] = useSearchParams();
  const nylas = search.get('nylas') || '';
  const autoLinked = search.get('autoLinked') === '1';
  const reason = search.get('reason') || '';
  const [me, setMe] = useState(undefined);
  const [loadErr, setLoadErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j.success) {
          setMe(null);
          return;
        }
        setMe(j.data);
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadErr(e.message || 'Failed to load session');
          setMe(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [nylas]);

  if (me === undefined) {
    return (
      <div className="login-page">
        <div className="login-card">
          <p className="page-desc">Checking session…</p>
        </div>
      </div>
    );
  }

  if (me === null) {
    return <Navigate to="/login?next=nylas" replace />;
  }

  const connected = me.nylas?.grantFromTenant && me.nylas?.grantConfigured;

  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: 520 }}>
        <h1 className="page-title">Connect your inbox</h1>
        {loadErr ? <div className="error" style={{ marginBottom: 12 }}>{loadErr}</div> : null}
        <p className="page-desc">
          Signed in as <strong>{me.user.email}</strong>. Grant Nylas access to the Gmail account you
          want InboxPilot to send from and read. If it is the same address as above, we will link it
          to your workspace automatically after you approve.
        </p>
        {nylas === 'ok' ? (
          <div
            className="error"
            style={{
              background: '#ecfdf5',
              borderColor: '#86efac',
              color: '#166534',
              marginBottom: 12,
            }}
          >
            {autoLinked
              ? 'Mailbox connected and linked to your Google sign-in. InboxPilot can use this inbox now (after your Nylas webhook is configured).'
              : 'Mailbox connected. If the connected address differs from your sign-in email, confirm business inbox settings under Settings.'}
          </div>
        ) : null}
        {nylas === 'denied' ? (
          <div className="error" style={{ marginBottom: 12 }}>
            Nylas authorization was cancelled. You can try again when you are ready.
          </div>
        ) : null}
        {nylas === 'error' ? (
          <div className="error" style={{ marginBottom: 12 }}>
            {reason
              ? decodeURIComponent(reason)
              : 'Connection failed. Check server logs and Nylas app settings.'}
          </div>
        ) : null}
        {connected ? (
          <>
            <p style={{ color: 'var(--muted)' }}>
              Nylas grant is saved for your workspace
              {me.nylas?.mailboxEmail ? ` (${me.nylas.mailboxEmail})` : ''}.
            </p>
            <Link to="/" style={{ display: 'inline-block', marginTop: 16 }}>
              Open dashboard
            </Link>
          </>
        ) : (
          <a
            className="btn btn-primary"
            href="/api/auth/nylas/start"
            style={{ display: 'inline-block', marginTop: 8 }}
          >
            Connect Gmail with Nylas
          </a>
        )}
        <p style={{ marginTop: 20, fontSize: '0.85rem', color: 'var(--muted)' }}>
          <Link to="/settings">Settings</Link>
          {' · '}
          <Link to="/">Dashboard</Link>
        </p>
      </div>
    </div>
  );
}
