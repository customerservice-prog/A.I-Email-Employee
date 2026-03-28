const { OAuth2Client } = require('google-auth-library');

/**
 * Verifies a Google Identity Services credential (JWT) and returns profile fields.
 * @param {string} idToken
 * @returns {Promise<{ sub: string, email: string, emailVerified: boolean, name?: string, picture?: string }>}
 */
async function verifyGoogleIdToken(idToken) {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  if (!clientId) {
    throw Object.assign(new Error('GOOGLE_CLIENT_ID is not configured'), {
      code: 'google_not_configured',
    });
  }
  if (!idToken || typeof idToken !== 'string') {
    throw Object.assign(new Error('Missing credential'), { code: 'google_missing_token' });
  }
  const client = new OAuth2Client(clientId);
  const ticket = await client.verifyIdToken({
    idToken: idToken.trim(),
    audience: clientId,
  });
  const p = ticket.getPayload();
  if (!p?.sub || !p?.email) {
    throw Object.assign(new Error('Invalid Google token payload'), { code: 'google_invalid_payload' });
  }
  return {
    sub: p.sub,
    email: p.email,
    emailVerified: Boolean(p.email_verified),
    name: p.name || undefined,
    picture: p.picture || undefined,
  };
}

module.exports = { verifyGoogleIdToken };
