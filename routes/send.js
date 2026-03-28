const express = require('express');
const { pool } = require('../db/connection');
const { sendApprovedReply } = require('../services/outboundEmail');
const { saveFeedback } = require('../services/feedback');
const { requireDatabase } = require('../middleware/database');
const { mapEmailRow } = require('../services/emailStore');
const { STATUS } = require('../lib/constants');
const { audit } = require('../lib/auditLog');
const { saveLearnedDraft } = require('../services/learnedMemory');
const { getTenantSettings } = require('../services/tenantSettings');

const router = express.Router();
router.use(requireDatabase);

function normalizeDraft(s) {
  return String(s || '').replace(/\r\n/g, '\n').trim();
}

router.post('/', async (req, res) => {
  const requestId = res.locals.requestId;
  try {
    const tenantId = req.tenantId;
    const emailId = parseInt(req.body?.emailId, 10);
    const draft = req.body?.draft;
    const originalDraft =
      req.body?.originalDraft !== undefined
        ? req.body.originalDraft
        : req.body?.original_draft;
    const editorId = req.body?.editorId || req.body?.editor_id || null;

    if (Number.isNaN(emailId)) {
      return res.status(400).json({
        success: false,
        error: { message: 'emailId is required', code: 'validation' },
        requestId,
      });
    }
    if (draft === undefined || draft === null || String(draft).trim() === '') {
      return res.status(400).json({
        success: false,
        error: { message: 'draft is required', code: 'validation' },
        requestId,
      });
    }

    const draftText = String(draft);
    const normalizedOut = normalizeDraft(draftText);
    const normalizedIn =
      originalDraft !== undefined && originalDraft !== null
        ? normalizeDraft(originalDraft)
        : null;

    const existing = await pool.query(
      `SELECT * FROM emails WHERE id = $1 AND tenant_id = $2`,
      [emailId, tenantId]
    );
    if (existing.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Email not found', code: 'not_found' },
        requestId,
      });
    }

    const email = existing.rows[0];
    if (email.status === STATUS.SENT) {
      return res.status(409).json({
        success: false,
        error: {
          message: 'This email was already sent',
          code: 'already_sent',
        },
        requestId,
      });
    }
    if (email.status === STATUS.ESCALATED) {
      return res.status(409).json({
        success: false,
        error: {
          message: 'This email is escalated; resolve in your inbox before sending from here',
          code: 'escalated',
        },
        requestId,
      });
    }
    await sendApprovedReply({
      tenantId,
      emailRow: email,
      body: draftText,
      mode: 'manual',
    });

    const tenant = await getTenantSettings(tenantId);
    if (tenant.settings.learnedMemoryDrafts !== false) {
      const memBody =
        email.body_cleaned || email.body_raw || email.body || '';
      await saveLearnedDraft(
        tenantId,
        email.subject || '',
        memBody,
        [],
        normalizeDraft(draftText),
        'human_send'
      );
    }

    audit('email_sent_manual', {
      requestId,
      tenantId,
      emailId,
      draftLen: draftText.length,
    });

    const baseDraft = normalizeDraft(email.draft || '');
    const originalForFeedback =
      normalizedIn !== null ? normalizedIn : baseDraft;
    const shouldRecordFeedback =
      originalForFeedback !== normalizedOut &&
      (originalForFeedback.length > 0 || normalizedOut.length > 0);

    if (shouldRecordFeedback) {
      await saveFeedback({
        tenantId,
        emailId,
        emailSubject: email.subject,
        originalDraft: originalForFeedback,
        correctedDraft: normalizedOut,
        editorId,
      });
    }

    const out = await pool.query(`SELECT * FROM emails WHERE id = $1`, [
      emailId,
    ]);
    return res.json({
      success: true,
      data: {
        email: mapEmailRow(out.rows[0]),
        feedbackSaved: shouldRecordFeedback,
      },
      requestId,
    });
  } catch (err) {
    if (err.code === 'already_sent') {
      return res.status(409).json({
        success: false,
        error: { message: err.message || 'Already sent', code: 'already_sent' },
        requestId: res.locals.requestId,
      });
    }
    const nylasStatus =
      typeof err.statusCode === 'number' ? err.statusCode : null;
    const status =
      nylasStatus && nylasStatus >= 400 && nylasStatus < 600
        ? nylasStatus
        : 500;
    return res.status(status).json({
      success: false,
      error: {
        message: err.message || 'Send failed',
        code: err.code || 'send_error',
      },
      requestId: res.locals.requestId,
    });
  }
});

module.exports = router;
