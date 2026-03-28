const { pool, hasDatabase } = require('../db/connection');
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
  if (!hasDatabase() || !pool) return null;
  const r = await pool.query(`SELECT * FROM tenants WHERE tenant_key = $1`, [
    tenantKey,
  ]);
  return r.rows[0] || null;
}

/**
 * Per-tenant Nylas grant. Env NYLAS_GRANT_ID applies only to tenant `default`
 * (or all tenants when NYLAS_USE_ENV_GRANT_FALLBACK=true) for legacy single-mailbox deploys.
 * @param {string} tenantKey
 */
async function getEffectiveNylasGrantId(tenantKey) {
  const envGrant = (process.env.NYLAS_GRANT_ID || '').trim();
  const globalFallback =
    String(process.env.NYLAS_USE_ENV_GRANT_FALLBACK || '').toLowerCase() === 'true';
  const allowEnvForTenant =
    globalFallback || tenantKey === 'default';

  if (!hasDatabase()) {
    if (!envGrant || !allowEnvForTenant) return null;
    return envGrant;
  }

  const row = await getTenantRow(tenantKey);
  const fromDb = row?.nylas_grant_id && String(row.nylas_grant_id).trim();
  if (fromDb) return fromDb;
  if (!envGrant || !allowEnvForTenant) return null;
  return envGrant;
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
    const effective = await getEffectiveNylasGrantId(tenantKey);
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
      nylasConnectedEmail: null,
      nylasGrantFromTenant: false,
      nylasGrantConfigured: Boolean(
        (process.env.NYLAS_API_KEY || '').trim() && effective
      ),
    };
  }
  const nylasGrantId = await getEffectiveNylasGrantId(tenantKey);
  return {
    tenantKey: row.tenant_key,
    businessEmail: row.business_email,
    provider: row.provider,
    displayModel: row.display_model || 'gpt-4o',
    autoSendThreshold: Number(row.auto_send_threshold) || 0.9,
    settings: mergeSettings(row),
    nylasConnectedEmail: row.nylas_connected_email || null,
    nylasGrantFromTenant: Boolean(
      row.nylas_grant_id && String(row.nylas_grant_id).trim()
    ),
    nylasGrantConfigured: Boolean(
      (process.env.NYLAS_API_KEY || '').trim() && nylasGrantId
    ),
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

/**
 * @param {string} tenantKey
 * @param {{ grantId: string, connectedEmail?: string | null }} nylas
 */
async function setTenantNylasGrant(tenantKey, nylas) {
  if (!pool) {
    throw new Error('Database not configured');
  }
  await ensureTenant(tenantKey);
  await pool.query(
    `UPDATE tenants SET
        nylas_grant_id = $2,
        nylas_connected_email = $3,
        updated_at = NOW()
     WHERE tenant_key = $1`,
    [tenantKey, nylas.grantId, nylas.connectedEmail ?? null]
  );
  return getTenantRow(tenantKey);
}

/**
 * When the mailbox matches the signed-in Google email, align business inbox fields.
 * @param {string} tenantKey
 * @param {{ grantEmail: string, userEmail: string }} emails
 */
async function applyAutoLinkedBusinessEmail(tenantKey, { grantEmail, userEmail }) {
  const g = String(grantEmail || '')
    .trim()
    .toLowerCase();
  const u = String(userEmail || '')
    .trim()
    .toLowerCase();
  if (!g || !u || g !== u) return { linked: false };
  await pool.query(
    `UPDATE tenants SET
        business_email = COALESCE(business_email, $2),
        provider = COALESCE(provider, 'gmail'),
        updated_at = NOW()
     WHERE tenant_key = $1`,
    [tenantKey, grantEmail.trim()]
  );
  return { linked: true };
}

module.exports = {
  getTenantSettings,
  updateTenantSettings,
  ensureTenant,
  getEffectiveNylasGrantId,
  setTenantNylasGrant,
  applyAutoLinkedBusinessEmail,
  DEFAULT_SETTINGS,
};
