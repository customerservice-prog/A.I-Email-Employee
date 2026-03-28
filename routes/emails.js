const express = require('express');
const { pool } = require('../db/connection');
const { requireDatabase } = require('../middleware/database');
const { updateEmailEscalated, mapEmailRow, getFeedbackForEmail } = require('../services/emailStore');
const { STATUS, TRACK } = require('../lib/constants');
const {
  parsePositiveInt,
  validateEmailListQuery,
} = require('../lib/validateApi');
const { audit } = require('../lib/auditLog');

const router = express.Router();
router.use(requireDatabase);

function canonicalListFilters(query) {
  let { status, track } = query;
  if (track === 'human_loop') track = TRACK.REVIEW;
  if (track === 'auto_pilot') track = TRACK.AUTO;
  if (status === 'pending_review') status = STATUS.PENDING;
  return { status, track };
}

router.get('/', async (req, res) => {
  const requestId = res.locals.requestId;
  try {
    const tenantId = req.tenantId;
    const { status, track } = canonicalListFilters(req.query);
    const qErr = validateEmailListQuery(status, track);
    if (qErr) {
      return res.status(400).json({
        success: false,
        error: { message: qErr.error, code: 'validation' },
        requestId,
      });
    }
    const lim = parsePositiveInt(req.query.limit, 100);
    const limit = lim === null ? 50 : Math.min(lim, 100);
    let off = parseInt(req.query.offset, 10);
    if (Number.isNaN(off) || off < 0) off = 0;
    off = Math.min(off, 100_000);

    let sql = `SELECT * FROM emails WHERE tenant_id = $1`;
    const params = [tenantId];
    let i = 2;

    if (status) {
      sql += ` AND status = $${i}`;
      params.push(String(status));
      i++;
    }
    if (track) {
      sql += ` AND track = $${i}`;
      params.push(String(track));
      i++;
    }

    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*)::int AS c');
    const countResult = await pool.query(countSql, params);
    const total = countResult.rows[0]?.c ?? 0;

    sql += ` ORDER BY COALESCE(received_at, created_at) DESC LIMIT $${i} OFFSET $${i + 1}`;
    params.push(limit, off);

    const result = await pool.query(sql, params);
    return res.json({
      success: true,
      data: {
        emails: result.rows.map(mapEmailRow),
        total,
        limit,
        offset: off,
      },
      requestId,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to list emails', code: 'list_error' },
      requestId,
    });
  }
});

router.post('/:id/escalate', async (req, res) => {
  const requestId = res.locals.requestId;
  try {
    const tenantId = req.tenantId;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid email id', code: 'validation' },
        requestId,
      });
    }
    const existing = await pool.query(
      `SELECT id FROM emails WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    if (existing.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Email not found', code: 'not_found' },
        requestId,
      });
    }
    await updateEmailEscalated(id, tenantId);
    audit('email_escalated', { requestId, tenantId, emailId: id });
    return res.json({ success: true, data: { id, status: 'escalated' }, requestId });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { message: 'Escalate failed', code: 'escalate_error' },
      requestId,
    });
  }
});

router.get('/:id', async (req, res) => {
  const requestId = res.locals.requestId;
  try {
    const tenantId = req.tenantId;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid email id', code: 'validation' },
        requestId,
      });
    }

    const result = await pool.query(
      `SELECT * FROM emails WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Email not found', code: 'not_found' },
        requestId,
      });
    }

    const feedback = await getFeedbackForEmail(tenantId, id);
    return res.json({
      success: true,
      data: { email: mapEmailRow(result.rows[0]), feedback },
      requestId,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to load email', code: 'get_error' },
      requestId,
    });
  }
});

module.exports = router;
