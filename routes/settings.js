const express = require('express');
const { requireDatabase } = require('../middleware/database');
const {
  getTenantSettings,
  updateTenantSettings,
} = require('../services/tenantSettings');
const { validateSettingsPut } = require('../lib/validateApi');
const { audit } = require('../lib/auditLog');

const router = express.Router();
router.use(requireDatabase);

router.get('/', async (req, res) => {
  const requestId = res.locals.requestId;
  try {
    const data = await getTenantSettings(req.tenantId);
    return res.json({
      success: true,
      data: {
        ...data,
        openAiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
        nylasConfigured: Boolean(
          process.env.NYLAS_API_KEY && process.env.NYLAS_GRANT_ID
        ),
      },
      requestId,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to load settings', code: 'settings_error' },
      requestId,
    });
  }
});

router.put('/', async (req, res) => {
  const requestId = res.locals.requestId;
  try {
    const parsed = validateSettingsPut(req.body);
    if (parsed.error) {
      return res.status(400).json({
        success: false,
        error: { message: parsed.error, code: 'validation' },
        requestId,
      });
    }
    if (Object.keys(parsed.value).length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'No valid fields to update', code: 'validation' },
        requestId,
      });
    }
    const updated = await updateTenantSettings(req.tenantId, parsed.value);
    audit('settings_updated', {
      requestId,
      tenantId: req.tenantId,
      keys: Object.keys(parsed.value),
    });
    return res.json({ success: true, data: updated, requestId });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to save settings', code: 'settings_save_error' },
      requestId,
    });
  }
});

module.exports = router;
