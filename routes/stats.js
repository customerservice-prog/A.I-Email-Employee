const express = require('express');
const { requireDatabase } = require('../middleware/database');
const { getDashboardMetrics, mapEmailRow } = require('../services/emailStore');

const router = express.Router();
router.use(requireDatabase);

router.get('/', async (req, res) => {
  const requestId = res.locals.requestId;
  try {
    const tenantId = req.tenantId;
    const metrics = await getDashboardMetrics(tenantId);
    return res.json({
      success: true,
      data: {
        ...metrics,
        recentEmails: (metrics.recentEmails || []).map(mapEmailRow),
      },
      requestId,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to load stats', code: 'stats_error' },
      requestId,
    });
  }
});

module.exports = router;
