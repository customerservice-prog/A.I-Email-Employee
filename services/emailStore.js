const { pool } = require('../db/connection');
const { TRACK, STATUS } = require('../lib/constants');

/**
 * @param {object} emailObj
 */
async function saveEmail(emailObj) {
  if (!pool) {
    throw new Error('Database not configured');
  }
  const {
    tenantId,
    externalMessageId = null,
    threadId = null,
    fromEmail,
    toEmail,
    fromDisplayName = null,
    subject = null,
    bodyRaw = null,
    bodyCleaned = null,
    status = STATUS.PENDING,
    track = TRACK.REVIEW,
    confidence = null,
    flags = [],
    classificationReasoning = null,
    draft = null,
    metadata = {},
  } = emailObj;

  const flagsJson = JSON.stringify(Array.isArray(flags) ? flags : []);
  const metaJson = JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {});

  const result = await pool.query(
    `INSERT INTO emails (
        tenant_id, external_message_id, nylas_message_id, thread_id,
        from_email, to_email, from_display_name, subject,
        body, body_raw, body_cleaned, received_at,
        status, track, confidence, flags,
        classification_reasoning, draft, metadata
      )
      VALUES (
        $1, $2::text, $3::text, $4,
        $5, $6, $7, $8,
        $9, $10, $11, NOW(),
        $12, $13, $14, $15::jsonb,
        $16, $17, $18::jsonb
      )
      RETURNING *`,
    [
      tenantId,
      externalMessageId,
      externalMessageId,
      threadId,
      fromEmail,
      toEmail,
      fromDisplayName,
      subject,
      bodyRaw,
      bodyRaw,
      bodyCleaned,
      status,
      track,
      confidence,
      flagsJson,
      classificationReasoning,
      draft,
      metaJson,
    ]
  );
  return result.rows[0];
}

/**
 * Inserts an inbound email; on unique (tenant_id, external_message_id) violation
 * returns the existing row so concurrent duplicate webhooks never double-process.
 * @returns {Promise<{ row: object, duplicate: boolean }>}
 */
async function saveEmailIdempotent(emailObj) {
  if (!pool) {
    throw new Error('Database not configured');
  }
  const ext = emailObj.externalMessageId;
  if (!ext) {
    const row = await saveEmail(emailObj);
    return { row, duplicate: false };
  }
  try {
    const row = await saveEmail(emailObj);
    return { row, duplicate: false };
  } catch (e) {
    if (e.code === '23505') {
      const r = await pool.query(
        `SELECT * FROM emails WHERE tenant_id = $1 AND external_message_id = $2`,
        [emailObj.tenantId, ext]
      );
      if (r.rows[0]) {
        return { row: r.rows[0], duplicate: true };
      }
    }
    throw e;
  }
}

async function updateEmailDraft(id, draft, { preservePrevious = false } = {}) {
  if (!pool) {
    throw new Error('Database not configured');
  }
  if (preservePrevious) {
    await pool.query(
      `UPDATE emails SET
         draft_previous = draft,
         draft = $2,
         updated_at = NOW()
       WHERE id = $1`,
      [id, draft]
    );
  } else {
    await pool.query(
      `UPDATE emails SET draft = $2, updated_at = NOW() WHERE id = $1`,
      [id, draft]
    );
  }
}

async function updateEmailStatus(id, status, finalReply) {
  if (!pool) {
    throw new Error('Database not configured');
  }
  const sentFrag =
    status === STATUS.SENT ? ', sent_at = COALESCE(sent_at, NOW())' : '';
  await pool.query(
    `UPDATE emails
     SET status = $2,
         final_reply = $3,
         updated_at = NOW()
         ${sentFrag}
     WHERE id = $1`,
    [id, status, finalReply ?? null]
  );
}

async function updateEmailEscalated(id, tenantId) {
  if (!pool) {
    throw new Error('Database not configured');
  }
  await pool.query(
    `UPDATE emails
     SET status = $3, track = $4, updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId, STATUS.ESCALATED, TRACK.REVIEW]
  );
}

async function saveSendLog(entry) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO send_log (
        tenant_id, email_id, nylas_message_id, body_preview,
        payload_snapshot, provider_response, success
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [
      entry.tenantId,
      entry.emailId,
      entry.nylasMessageId ?? null,
      entry.bodyPreview != null ? String(entry.bodyPreview).slice(0, 2000) : null,
      JSON.stringify(entry.payloadSnapshot || {}),
      JSON.stringify(entry.providerResponse || {}),
      entry.success !== false,
    ]
  );
}

async function getRecentFeedback(tenantId, limit) {
  if (!pool) {
    return [];
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const result = await pool.query(
    `SELECT id, tenant_id, email_id, email_subject, original_draft, corrected_draft, created_at, editor_id
     FROM feedback
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [tenantId, safeLimit]
  );
  return result.rows;
}

async function getFeedbackForEmail(tenantId, emailId) {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT * FROM feedback WHERE tenant_id = $1 AND email_id = $2 ORDER BY created_at DESC`,
    [tenantId, emailId]
  );
  return r.rows;
}

/**
 * @param {string} tenantId
 * @param {object} [opts]
 */
async function getDashboardMetrics(tenantId, opts = {}) {
  if (!pool) {
    return {
      emailsToday: 0,
      autoPilotSentToday: 0,
      pendingReview: 0,
      avgConfidence7d: null,
      recentEmails: [],
      activity: [],
    };
  }

  const todayStart = opts.todayStart ? new Date(opts.todayStart) : new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const d1 = await pool.query(
    `SELECT COUNT(*)::int AS c FROM emails
     WHERE tenant_id = $1 AND COALESCE(received_at, created_at) >= $2`,
    [tenantId, todayStart]
  );

  const d2 = await pool.query(
    `SELECT COUNT(*)::int AS c FROM emails
     WHERE tenant_id = $1 AND COALESCE(received_at, created_at) >= $2
       AND track = 'auto' AND status = 'sent'`,
    [tenantId, todayStart]
  );

  const d3 = await pool.query(
    `SELECT COUNT(*)::int AS c FROM emails
     WHERE tenant_id = $1 AND status = 'pending'`,
    [tenantId]
  );

  const d4 = await pool.query(
    `SELECT AVG(confidence)::float AS a FROM emails
     WHERE tenant_id = $1 AND confidence IS NOT NULL
       AND COALESCE(received_at, created_at) >= NOW() - INTERVAL '7 days'`,
    [tenantId]
  );

  const recent = await pool.query(
    `SELECT * FROM emails
     WHERE tenant_id = $1
     ORDER BY COALESCE(received_at, created_at) DESC
     LIMIT 12`,
    [tenantId]
  );

  const log = await pool.query(
    `SELECT sl.*, e.subject, e.from_email, e.from_display_name
     FROM send_log sl
     LEFT JOIN emails e ON e.id = sl.email_id
     WHERE sl.tenant_id = $1
     ORDER BY sl.created_at DESC
     LIMIT 15`,
    [tenantId]
  );

  return {
    emailsToday: d1.rows[0]?.c ?? 0,
    autoPilotSentToday: d2.rows[0]?.c ?? 0,
    pendingReview: d3.rows[0]?.c ?? 0,
    avgConfidence7d: d4.rows[0]?.a ?? null,
    recentEmails: recent.rows,
    activity: log.rows,
  };
}

/** Map row for API: single "body" for clients preferring legacy shape */
function mapEmailRow(row) {
  if (!row) return row;
  return {
    ...row,
    body: row.body_cleaned || row.body_raw || row.body,
  };
}

module.exports = {
  saveEmail,
  saveEmailIdempotent,
  updateEmailDraft,
  updateEmailStatus,
  updateEmailEscalated,
  saveSendLog,
  getRecentFeedback,
  getFeedbackForEmail,
  getDashboardMetrics,
  mapEmailRow,
};
