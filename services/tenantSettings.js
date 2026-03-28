const { pool } = require('../db/connection');
const { sanitizeSettingsPatch } = require('../lib/validateApi');

const DEFAULT_SETTINGS = {
  autoSendHighConfidence: true,
  alwaysFlagDiscountRequests: false,
  ragOnlyMode: true,
  feedbackLoopLearning: true,
  learnedMemoryDrafts: true,
  learnedMemoryClassification: true,
};

function mergeSettings(row) {
  const stored =
    row?.settings && typeof row.settings === 'object' ? row.settings : {};
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
  };
}

async function getTenantRow(tenantKey) {
  if (!pool) return null;
  const r = await pool.query(`SELECT * FROM tenants WHERE tenant_key = $1`, [
    tenantKey,
  ]);
  return r.rows[0] || null;
}

/**
 * @param {string} tenantKey
 */
async function ensureTenant(tenantKey) {
  if (!pool) return null;
  await pool.query(
    `INSERT INTO tenants (tenant_key, display_model, auto_send_threshold, settings)
     VALUES ($1, 'gpt-4o', 0.90, $2::jsonb)
     ON CONFLICT (tenant_key) DO NOTHING`,
    [tenantKey, JSON.stringify(DEFAULT_SETTINGS)]
  );
  return getTenantRow(tenantKey);
}

/**
 * @param {string} tenantKey
 */
async function getTenantSettings(tenantKey) {
  let row = await getTenantRow(tenantKey);
  if (!row && pool) {
    row = await ensureTenant(tenantKey);
  }
  if (!row) {
    return {
      tenantKey,
      businessEmail: null,
      provider: null,
      displayModel: process.env.OPENAI_CLASSIFY_MODEL || 'gpt-4o',
      autoSendThreshold: parseFloat(
        process.env.AUTO_SEND_THRESHOLD || '0.9',
        10
      ),
      settings: { ...DEFAULT_SETTINGS },
    };
  }
  return {
    tenantKey: row.tenant_key,
    businessEmail: row.business_email,
    provider: row.provider,
    displayModel: row.display_model || 'gpt-4o',
    autoSendThreshold: Number(row.auto_send_threshold) || 0.9,
    settings: mergeSettings(row),
  };
}

/**
 * @param {string} tenantKey
 * @param {object} patch
 */
async function updateTenantSettings(tenantKey, patch) {
  if (!pool) {
    throw new Error('Database not configured');
  }
  await ensureTenant(tenantKey);
  const current = await getTenantRow(tenantKey);
  const settingsObj = {
    ...mergeSettings(current),
    ...sanitizeSettingsPatch(patch.settings),
  };

  await pool.query(
    `UPDATE tenants SET
        business_email = COALESCE($2, business_email),
        provider = COALESCE($3, provider),
        display_model = COALESCE($4, display_model),
        auto_send_threshold = COALESCE($5, auto_send_threshold),
        settings = $6::jsonb,
        updated_at = NOW()
     WHERE tenant_key = $1`,
    [
      tenantKey,
      patch.businessEmail !== undefined ? patch.businessEmail : null,
      patch.provider !== undefined ? patch.provider : null,
      patch.displayModel !== undefined ? patch.displayModel : null,
      patch.autoSendThreshold !== undefined
        ? Number(patch.autoSendThreshold)
        : null,
      JSON.stringify(settingsObj),
    ]
  );

  return getTenantSettings(tenantKey);
}

module.exports = {
  getTenantSettings,
  updateTenantSettings,
  ensureTenant,
  DEFAULT_SETTINGS,
};
