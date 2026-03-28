const { pool } = require('../db/connection');

/**
 * @param {object} params
 * @param {string} params.tenantId
 * @param {number} [params.emailId]
 * @param {string} [params.emailSubject]
 * @param {string} [params.originalDraft]
 * @param {string} [params.correctedDraft]
 */
async function saveFeedback({
  tenantId,
  emailId = null,
  emailSubject = null,
  originalDraft = null,
  correctedDraft = null,
  editorId = null,
}) {
  if (!pool) {
    throw new Error('Database not configured');
  }
  const result = await pool.query(
    `INSERT INTO feedback (
        tenant_id, email_id, email_subject, original_draft, corrected_draft, editor_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
    [tenantId, emailId, emailSubject, originalDraft, correctedDraft, editorId]
  );
  return result.rows[0];
}

module.exports = { saveFeedback };
