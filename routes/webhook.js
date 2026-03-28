const express = require('express');
const { pool, hasDatabase } = require('../db/connection');
const { evaluateWebhookAutoSend } = require('../lib/autoSendGate');
const { verifyNylasWebhook } = require('../services/nylasWebhookVerify');
const { normalizeInboundBody } = require('../services/emailNormalizer');
const { classifyInboundEmail } = require('../services/classifier');
const {
  saveEmailIdempotent,
  updateEmailDraft,
} = require('../services/emailStore');
const { generateDraft } = require('../services/draftGenerator');
const { sendApprovedReply } = require('../services/outboundEmail');
const { STATUS } = require('../lib/constants');
const logger = require('../lib/logger');

const router = express.Router();

function normalizeFlagsJson(flags) {
  if (Array.isArray(flags)) return flags.map(String);
  if (typeof flags === 'string') {
    try {
      const p = JSON.parse(flags);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function webhookTenantId() {
  return process.env.WEBHOOK_TENANT_ID || 'default';
}

function firstAddress(list) {
  if (!list || !list.length) return { email: '', name: '' };
  const x = list[0];
  if (typeof x === 'string') return { email: x, name: '' };
  return {
    email: (x.email || '').trim(),
    name: (x.name || '').trim(),
  };
}

function extractMessagePayload(body) {
  const d = body?.data?.object || body?.data || body?.object || body?.message;
  if (!d || typeof d !== 'object') return null;

  const fromList = d.from || [];
  const toList = d.to || [];
  const from = firstAddress(fromList);
  const to = firstAddress(toList);

  return {
    externalMessageId: d.id || d.message_id || null,
    threadId: d.thread_id || d.threadId || null,
    fromEmail: from.email || 'unknown@unknown',
    fromDisplayName: from.name || null,
    toEmail: to.email || 'inbox@local',
    subject: d.subject || '',
    bodyRaw: d.body || d.snippet || '',
  };
}

router.post('/', async (req, res) => {
  const tenantId = webhookTenantId();
  const requestId = res.locals.requestId || 'webhook';

  const raw = req.body;
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(JSON.stringify(raw || {}));

  const sig =
    req.get('x-nylas-signature') ||
    req.get('X-Nylas-Signature') ||
    req.get('nylas-signature');

  if (
    !verifyNylasWebhook(buf, sig, process.env.NYLAS_WEBHOOK_SECRET)
  ) {
    logger.warn('webhook_signature_invalid', { requestId });
    return res.status(401).json({
      success: false,
      error: { message: 'Invalid webhook signature', code: 'invalid_signature' },
      requestId,
    });
  }

  let payload;
  try {
    payload = JSON.parse(buf.toString('utf8'));
  } catch {
    return res.status(400).json({
      success: false,
      error: { message: 'Invalid JSON', code: 'bad_payload' },
      requestId,
    });
  }

  try {
    const type = payload?.type || payload?.trigger_type || '';
    if (
      type &&
      !String(type).includes('message') &&
      !String(type).includes('Message')
    ) {
      return res.status(200).json({ success: true, data: { ignored: true }, requestId });
    }

    const msg = extractMessagePayload(payload);
    if (!msg || !msg.fromEmail) {
      return res.status(200).json({ success: true, data: { skipped: true }, requestId });
    }

    if (!hasDatabase()) {
      logger.warn('webhook_no_database', { requestId });
      return res.status(200).json({ success: true, data: { skipped: true }, requestId });
    }

    const bodyCleaned = normalizeInboundBody(msg.bodyRaw, {
      subject: msg.subject,
    });

    let row = null;

    if (msg.externalMessageId) {
      const dup = await pool.query(
        `SELECT * FROM emails WHERE tenant_id = $1 AND external_message_id = $2`,
        [tenantId, msg.externalMessageId]
      );
      if (dup.rowCount > 0) {
        const existing = dup.rows[0];
        logger.info('webhook_duplicate_message_id', {
          requestId,
          emailId: existing.id,
          status: existing.status,
          hasDraft: String(existing.draft || '').trim().length > 0,
        });
        if (
          existing.status === STATUS.SENT ||
          existing.status === STATUS.FAILED
        ) {
          return res.status(200).json({
            success: true,
            data: { duplicate: true, id: existing.id },
            requestId,
          });
        }
        if (String(existing.draft || '').trim().length > 0) {
          return res.status(200).json({
            success: true,
            data: { duplicate: true, id: existing.id },
            requestId,
          });
        }
        row = existing;
      }
    } else {
      logger.warn('webhook_missing_external_id', {
        requestId,
        from: msg.fromEmail,
      });
    }

    if (!row) {
      const classification = await classifyInboundEmail(
        {
          subject: msg.subject,
          body: bodyCleaned,
          from: msg.fromEmail,
          fromEmail: msg.fromEmail,
        },
        tenantId
      );

      logger.info('webhook_classified', {
        requestId,
        track: classification.track,
        confidence: classification.confidence,
        flags: classification.flags,
        source: classification.source,
      });

      const { row: inserted, duplicate: insertDuplicate } =
        await saveEmailIdempotent({
          tenantId,
          externalMessageId: msg.externalMessageId,
          threadId: msg.threadId,
          fromEmail: msg.fromEmail,
          toEmail: msg.toEmail,
          fromDisplayName: msg.fromDisplayName,
          subject: msg.subject,
          bodyRaw: msg.bodyRaw,
          bodyCleaned,
          status: STATUS.PENDING,
          track: classification.track,
          confidence: classification.confidence,
          flags: classification.flags,
          classificationReasoning: classification.reasoning,
          metadata: { classification_source: classification.source },
        });

      if (insertDuplicate) {
        if (String(inserted.draft || '').trim().length > 0) {
          return res.status(200).json({
            success: true,
            data: { duplicate: true, id: inserted.id },
            requestId,
          });
        }
        row = inserted;
      } else {
        row = inserted;
      }
    }

    logger.info('webhook_email_processing', {
      requestId,
      emailId: row.id,
      externalMessageId: msg.externalMessageId || null,
    });

    let draftText = '';
    try {
      const gen = await generateDraft({ tenantId, email: row });
      draftText = gen.draft;
      await updateEmailDraft(row.id, draftText);
      logger.info('webhook_draft_ok', {
        requestId,
        emailId: row.id,
        draftChars: draftText.length,
        draftSource: gen.source,
      });
    } catch (e) {
      logger.error('webhook_draft_failed', {
        requestId,
        err: e.message,
        emailId: row.id,
      });
    }

    const fresh = await pool.query(`SELECT * FROM emails WHERE id = $1`, [
      row.id,
    ]);
    const emailRow = fresh.rows[0];
    const gateClassification = {
      track: emailRow.track,
      confidence: Number(emailRow.confidence),
      flags: normalizeFlagsJson(emailRow.flags),
    };

    const autoDecision = await evaluateWebhookAutoSend({
      tenantId,
      classification: gateClassification,
      draftText,
      emailRow,
    });

    if (!autoDecision.ok) {
      logger.info('webhook_auto_send_skipped', {
        requestId,
        emailId: row.id,
        reason: autoDecision.reason,
      });
    }

    if (autoDecision.ok) {
      try {
        await sendApprovedReply({
          tenantId,
          emailRow,
          body: draftText,
          mode: 'auto',
        });
        logger.info('webhook_auto_sent', { requestId, emailId: row.id });
        return res.status(200).json({
          success: true,
          data: { autoSent: true, emailId: row.id },
          requestId,
        });
      } catch (e) {
        logger.error('webhook_auto_send_failed', {
          requestId,
          err: e.message,
          emailId: row.id,
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: { emailId: row.id, track: emailRow.track },
      requestId,
    });
  } catch (err) {
    logger.error('webhook_failed', { requestId, err: err.message });
    return res.status(500).json({
      success: false,
      error: { message: 'Webhook processing failed', code: 'webhook_error' },
      requestId,
    });
  }
});

module.exports = router;
