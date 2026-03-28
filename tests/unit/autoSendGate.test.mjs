import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { TRACK, STATUS } from '../../lib/constants.js';

const require = createRequire(import.meta.url);
const { evaluateWebhookAutoSend } = require('../../lib/autoSendGate.js');

const mockTenant = {
  settings: { autoSendHighConfidence: true },
  autoSendThreshold: 0.9,
};

describe('evaluateWebhookAutoSend', () => {
  const countKbChunksForTenant = vi.fn();

  beforeEach(() => {
    process.env.AUTO_SEND_FROM_WEBHOOK = 'true';
    process.env.NYLAS_API_KEY = 'test-key';
    process.env.NYLAS_GRANT_ID = 'test-grant';
    countKbChunksForTenant.mockReset();
    countKbChunksForTenant.mockResolvedValue(0);
  });

  it('blocks on empty KB then allows ok when KB has chunks and Nylas is configured', async () => {
    const runtime = {
      getTenantSettings: vi.fn(async () => mockTenant),
      getEffectiveNylasGrantId: vi.fn(async () => 'test-grant'),
      countKbChunksForTenant,
    };

    const payload = {
      tenantId: 't1',
      classification: { track: TRACK.AUTO, confidence: 0.99, flags: [] },
      draftText:
        'This is a substantive customer reply that is clearly not a placeholder.',
      emailRow: { status: STATUS.PENDING, confidence: 0.99 },
    };

    countKbChunksForTenant.mockResolvedValue(0);
    const emptyKb = await evaluateWebhookAutoSend(payload, runtime);
    expect(emptyKb.ok).toBe(false);
    expect(emptyKb.reason).toBe('tenant_kb_empty');

    countKbChunksForTenant.mockResolvedValue(3);
    const withKb = await evaluateWebhookAutoSend(payload, runtime);
    expect(withKb.ok).toBe(true);
    expect(withKb.reason).toBe('ok');
  });
});
