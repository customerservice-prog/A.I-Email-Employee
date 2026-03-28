import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import crypto from 'crypto';

const require = createRequire(import.meta.url);

let app;
let pool;

function signNylasBody(secret, rawBuffer) {
  return crypto.createHmac('sha256', secret).update(rawBuffer).digest('hex');
}

function buildMessageWebhookPayload(overrides = {}) {
  const id = overrides.id || `nylas-msg-${crypto.randomBytes(4).toString('hex')}`;
  return {
    type: 'message.created',
    data: {
      object: {
        id,
        thread_id: 'thread_stub_1',
        from: [{ email: 'customer@example.com', name: 'Customer' }],
        to: [{ email: 'biz@example.com', name: 'Biz' }],
        subject: overrides.subject || 'Question about rental',
        body:
          overrides.body ||
          'Hello, do you have 20 chairs available this Saturday morning?',
      },
    },
  };
}

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'inboxpilot-it-'));
  Object.assign(process.env, {
    DATABASE_URL: 'pglite',
    PGLITE_DATA_DIR: dir,
    NODE_ENV: 'test',
    NYLAS_WEBHOOK_SECRET: 'whsec_integration_test',
    OPENAI_API_KEY: 'sk-test-integration',
    NYLAS_API_KEY: 'nylas-test-key',
    NYLAS_GRANT_ID: 'grant-test',
    AUTO_SEND_FROM_WEBHOOK: 'false',
    INBOXPILOT_MOCK_NYLAS_SEND: '1',
    INBOXPILOT_MOCK_OPENAI: '1',
    INBOXPILOT_API_SECRET: '',
  });

  const { buildApp } = require('../../app.js');
  const conn = require('../../db/connection');
  app = buildApp();
  pool = conn.pool;
});

afterAll(() => {
  if (process.env.PGLITE_DATA_DIR) {
    try {
      rmSync(process.env.PGLITE_DATA_DIR, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

beforeEach(async () => {
  await pool.query('SELECT 1');
  await pool.query(
    `TRUNCATE learned_reply_memory, learned_classification_memory, send_log, feedback, kb_chunks, kb_files, emails RESTART IDENTITY CASCADE`
  );
});

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data?.ok).toBe(true);
  });
});

describe('POST /api/knowledge/upload', () => {
  it('accepts a txt file and persists chunks', async () => {
    const text =
      'Bounce house weekday $199. Weekend $249. Generator add-on $75.\n\nDelivery within 15 miles included.';
    const res = await request(app)
      .post('/api/knowledge/upload')
      .attach('file', Buffer.from(text, 'utf8'), {
        filename: 'pricing.txt',
        contentType: 'text/plain',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data?.file?.id).toBeDefined();
    expect(Number(res.body.data?.file?.chunk_count || 0)).toBeGreaterThan(0);

    const list = await request(app).get('/api/knowledge/files').expect(200);
    expect(list.body.data?.files?.length).toBeGreaterThanOrEqual(1);
  });
});

describe('POST /api/webhook', () => {
  it('rejects invalid signature', async () => {
    const payload = buildMessageWebhookPayload();
    const body = JSON.stringify(payload);
    await request(app)
      .post('/api/webhook')
      .set('x-nylas-signature', 'deadbeef')
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(401);
  });

  it('ingests a message, classifies, drafts, and returns emailId', async () => {
    const payload = buildMessageWebhookPayload({ id: 'ext-webhook-1' });
    const body = JSON.stringify(payload);
    const sig = signNylasBody(
      process.env.NYLAS_WEBHOOK_SECRET,
      Buffer.from(body, 'utf8')
    );

    const res = await request(app)
      .post('/api/webhook')
      .set('x-nylas-signature', sig)
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data?.emailId).toBeDefined();

    const dup = await request(app)
      .post('/api/webhook')
      .set('x-nylas-signature', sig)
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(200);

    expect(dup.body.data?.duplicate).toBe(true);
    expect(dup.body.data?.id).toBe(res.body.data.emailId);
  });

  it('hard-blocks discount language without model classification path for scoring', async () => {
    const payload = buildMessageWebhookPayload({
      id: 'ext-discount-1',
      subject: 'Discount?',
      body: 'What discount can you give us on the bounce house?',
    });
    const body = JSON.stringify(payload);
    const sig = signNylasBody(
      process.env.NYLAS_WEBHOOK_SECRET,
      Buffer.from(body, 'utf8')
    );

    const res = await request(app)
      .post('/api/webhook')
      .set('x-nylas-signature', sig)
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(200);

    expect(res.body.data?.track).toBe('review');
    const row = await pool.query(`SELECT * FROM emails WHERE id = $1`, [
      res.body.data.emailId,
    ]);
    expect(row.rows[0].track).toBe('review');
    const flags = row.rows[0].flags;
    const asArray = Array.isArray(flags) ? flags : JSON.parse(flags || '[]');
    expect(asArray).toContain('discount_or_negotiation');
  });
});

describe('POST /api/send', () => {
  it('sends approved draft via Nylas and marks email sent', async () => {
    const { saveEmail } = require('../../services/emailStore.js');
    const { STATUS, TRACK } = require('../../lib/constants.js');

    const n0 = (await pool.query('SELECT COUNT(*)::int AS n FROM emails')).rows[0]
      .n;
    await saveEmail({
      tenantId: 'default',
      externalMessageId: 'ext-send-int',
      threadId: null,
      fromEmail: 'buyer@example.com',
      toEmail: 'shop@example.com',
      fromDisplayName: null,
      subject: 'Hello',
      bodyRaw: 'Hi',
      bodyCleaned: 'Hi',
      status: STATUS.PENDING,
      track: TRACK.REVIEW,
      confidence: null,
      flags: [],
      classificationReasoning: null,
      draft: 'Draft line one. Draft line two for length.',
      metadata: {},
    });
    const n1 = (await pool.query('SELECT COUNT(*)::int AS n FROM emails')).rows[0]
      .n;
    expect(n1).toBe(n0 + 1);

    const lookup = await pool.query(
      `SELECT id FROM emails WHERE tenant_id = $1 AND external_message_id = $2`,
      ['default', 'ext-send-int']
    );
    expect(lookup.rowCount).toBe(1);
    const emailId = Number(lookup.rows[0].id);
    expect(Number.isFinite(emailId)).toBe(true);

    const getRes = await request(app)
      .get(`/api/emails/${emailId}`)
      .set('x-tenant-id', 'default')
      .expect(200);
    expect(getRes.body.data?.email?.id).toBe(emailId);

    const res = await request(app)
      .post('/api/send')
      .set('x-tenant-id', 'default')
      .send({
        emailId,
        draft:
          'Thank you for your message. Here is our official reply with enough characters to pass validation checks easily.',
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data?.email?.status).toBe('sent');

    const logs = await pool.query(
      `SELECT * FROM send_log WHERE email_id = $1 ORDER BY id DESC`,
      [emailId]
    );
    expect(logs.rowCount).toBeGreaterThanOrEqual(1);
    expect(logs.rows[0].success).toBe(true);
  });
});
