const nodemailer = require('nodemailer');
const logger = require('../lib/logger');

function smtpConfigured() {
  return Boolean(String(process.env.SMTP_HOST || '').trim());
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildTransport() {
  if (!smtpConfigured()) return null;
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '');
  return nodemailer.createTransport({
    host: String(process.env.SMTP_HOST).trim(),
    port: Number(process.env.SMTP_PORT || '587') || 587,
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: user ? { user, pass } : undefined,
  });
}

/**
 * @param {{ to: string, resetUrl: string }} opts
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
async function sendPasswordResetEmail(opts) {
  const to = String(opts.to || '').trim();
  const resetUrl = String(opts.resetUrl || '').trim();
  if (!to || !resetUrl) {
    return { sent: false, reason: 'missing_params' };
  }
  const transporter = buildTransport();
  if (!transporter) {
    return { sent: false, reason: 'mail_not_configured' };
  }
  const from = String(
    process.env.SMTP_FROM || process.env.SMTP_USER || ''
  ).trim();
  if (!from) {
    logger.warn('smtp_from_missing', {
      msg: 'Set SMTP_FROM or SMTP_USER to send transactional email',
    });
    return { sent: false, reason: 'from_missing' };
  }
  const appName = String(process.env.APP_NAME || 'InboxPilot').trim();
  try {
    await transporter.sendMail({
      from,
      to,
      subject: `Reset your ${appName} password`,
      text: [
        `We received a request to reset your ${appName} password.`,
        '',
        resetUrl,
        '',
        'If you did not request this, you can ignore this email.',
      ].join('\n'),
      html: `<p>We received a request to reset your ${escapeHtml(appName)} password.</p>
<p><a href="${escapeHtml(resetUrl)}">Reset your password</a></p>
<p>If you did not request this, you can ignore this email.</p>`,
    });
    logger.info('password_reset_email_sent', { to });
    return { sent: true };
  } catch (e) {
    logger.error('password_reset_email_failed', {
      to,
      err: e.message,
    });
    return { sent: false, reason: 'send_failed' };
  }
}

module.exports = {
  smtpConfigured,
  sendPasswordResetEmail,
};
