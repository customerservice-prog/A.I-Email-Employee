const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function validateRegisterBody(body) {
  const email = normalizeEmail(body?.email);
  const password = body?.password != null ? String(body.password) : '';
  if (!email || !EMAIL_RE.test(email)) {
    return { error: 'Invalid email address' };
  }
  if (password.length < 10) {
    return { error: 'Password must be at least 10 characters' };
  }
  if (password.length > 256) {
    return { error: 'Password too long' };
  }
  return { value: { email, password } };
}

function validateLoginBody(body) {
  const email = normalizeEmail(body?.email);
  const password = body?.password != null ? String(body.password) : '';
  if (!email || !password) {
    return { error: 'Email and password are required' };
  }
  return { value: { email, password } };
}

function validateResetRequestBody(body) {
  const email = normalizeEmail(body?.email);
  if (!email) {
    return { error: 'Email is required' };
  }
  return { value: { email } };
}

function validateResetPasswordBody(body) {
  const token = body?.token != null ? String(body.token).trim() : '';
  const password = body?.password != null ? String(body.password) : '';
  if (!token || token.length < 20) {
    return { error: 'Invalid reset token' };
  }
  if (password.length < 10) {
    return { error: 'Password must be at least 10 characters' };
  }
  return { value: { token, password } };
}

module.exports = {
  normalizeEmail,
  validateRegisterBody,
  validateLoginBody,
  validateResetRequestBody,
  validateResetPasswordBody,
};
