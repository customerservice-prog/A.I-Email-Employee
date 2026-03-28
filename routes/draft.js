const express = require('express');
const { pool } = require('../db/connection');
const { generateDraft } = require('../services/draftGenerator');
const { requireDatabase } = require('../middleware/database');
const { mapEmailRow, updateEmailDraft } = require('../services/emailStore');
const { audit } = require('../lib/auditLog');

const router = express.Router();
router.use(requireDatabase);

router.post('/', async (req, res) => {
  const requestId = res.locals.requestId;
  try {
    const tenantId = req.tenantId;
    const emailId = parseInt(req.body?.emailId, 10);
    const preservePrevious = Boolean(req.body?.preservePrevious);
    const regenerate = Boolean(req.body?.regenerate);

    if (Number.isNaN(emailId)) {
      return res.status(400).json({
        success: false,
        error: { message: 'emailId is required', code: 'validation' },
        requestId,
      });
    }

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
    const { draft, source: draftSource } = await generateDraft(
      { tenantId, email },
      { regenerate }
    );

    await updateEmailDraft(emailId, draft, { preservePrevious });

    audit('draft_generated', {
      requestId,
      tenantId,
      emailId,
      regenerate,
      draftLen: draft.length,
      draftSource,
    });

    const updated = await pool.query(`SELECT * FROM emails WHERE id = $1`, [
      emailId,
    ]);

    return res.json({
      success: true,
      data: { draft, email: mapEmailRow(updated.rows[0]) },
      requestId,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: {
        message: err.message || 'Draft generation failed',
        code: 'draft_error',
      },
      requestId,
    });
  }
});

module.exports = router;
