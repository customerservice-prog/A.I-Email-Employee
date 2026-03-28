const { sendEmail } = require('./emailSender');
const { pool } = require('../db/connection');
const { STATUS } = require('../lib/constants');
const logger = require('../lib/logger');
const { sanitizePlainTextEmailBody } = require('../lib/sanitizeOutbound');

function replySubject(original) {
  if (!original) return 'Re:';
  const s = String(original).trim();
  if (/^re:/i.test(s)) return s;
  return `Re: ${s}`;
}

/**
 * Single path for outbound sends: Nylas + DB status + send_log row.
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {object} opts.emailRow full row (from_email, subject, thread_id, id)
 * @param {string} opts.body
 * @param {string} [opts.mode] auto | manual
 */
async function sendApprovedReply({ tenantId, emailRow, body, mode = 'manual' }) {
  const safeBody = sanitizePlainTextEmailBody(body);
  const to = emailRow.from_email;
  const subject = replySubject(emailRow.subject);

  if (emailRow.status === STATUS.SENT) {
    const err = new Error('This email was already sent');
    err.statusCode = 409;
    err.code = 'already_sent';
    throw err;
  }

  let providerResponse = null;
  let nylasId = null;
  let success = false;

  try {
    const sent = await sendEmail({
      to,
      subject,
      body: safeBody,
      threadId: emailRow.thread_id || undefined,
      tenantId,
    });
    providerResponse = sent;
    nylasId = sent?.id || sent?.data?.id || null;
    success = true;
  } catch (err) {
    providerResponse = {
      error: err.message,
      statusCode: err.statusCode,
      name: err.name,
    };
    if (pool && emailRow.id) {
      await pool.query(
        `UPDATE emails SET status = $2, metadata = metadata || $3::jsonb, updated_at = NOW() WHERE id = $1`,
        [
          emailRow.id,
          STATUS.FAILED,
          JSON.stringify({
            last_send_error: err.message,
            last_send_at: new Date().toISOString(),
            mode,
          }),
        ]
      );
      await pool.query(
        `INSERT INTO send_log (tenant_id, email_id, nylas_message_id, body_preview, payload_snapshot, provider_response, success)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
        [
          tenantId,
          emailRow.id,
          null,
          String(safeBody).slice(0, 2000),
          JSON.stringify({ mode, subject, to }),
          JSON.stringify(providerResponse),
          false,
        ]
      );
    }
    logger.error('outbound_send_failed', {
      emailId: emailRow.id,
      tenantId,
      mode,
      err: err.message,
    });
    throw err;
  }

  if (pool && emailRow.id) {
    await pool.query(
      `UPDATE emails SET status = $2, final_reply = $3, sent_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [emailRow.id, STATUS.SENT, safeBody]
    );
    await pool.query(
      `INSERT INTO send_log (tenant_id, email_id, nylas_message_id, body_preview, payload_snapshot, provider_response, success)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
      [
        tenantId,
        emailRow.id,
        nylasId,
        String(safeBody).slice(0, 2000),
        JSON.stringify({ mode, subject, to }),
        JSON.stringify(providerResponse),
        success,
      ]
    );
  }

  logger.info('outbound_send_ok', {
    emailId: emailRow.id,
    tenantId,
    mode,
    nylasId,
  });

  return { nylasId, providerResponse, success };
}

module.exports = { sendApprovedReply, replySubject };
