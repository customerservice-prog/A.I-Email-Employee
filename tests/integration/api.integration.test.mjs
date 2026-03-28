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

const MACHINE = 'integration-test-machine-key';

function signNylasBody(secret, rawBuffer) {
  return crypto.createHmac('sha256', secret).update(rawBuffer).digest('hex');
}

function buildMessageWebhookPayload(overrides = {}) {
  const id = overrides.id || `nylas-msg-${crypto.randomBytes(4).toString('hex')}`;
  return {
    type: 'message.created',
    data: {
      grant_id: overrides.grantId || 'grant-test',
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

beforeAll(async () => {
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
    INBOXPILOT_MACHINE_KEY: MACHINE,
  });

  const { buildApp } = require('../../app.js');
  const conn = require('../../db/connection');
  app = buildApp();
  pool = conn.pool;
  await pool.query(
    `UPDATE tenants SET nylas_grant_id = $1 WHERE tenant_key = 'default'`,
    ['grant-test']
  );
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
    `TRUNCATE password_reset_tokens, sessions, users RESTART IDENTITY CASCADE`
  );
  await pool.query(
    `TRUNCATE learned_reply_memory, learned_classification_memory, send_log, feedback, kb_chunks, kb_files, emails RESTART IDENTITY CASCADE`
  );
  await pool.query(
    `UPDATE tenants SET nylas_grant_id = $1 WHERE tenant_key = 'default'`,
    ['grant-test']
  );
});

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data?.ok).toBe(true);
  });
});

describe('API auth', () => {
  it('returns 401 for protected routes without session or machine key', async () => {
    await request(app).get('/api/emails').expect(401);
    await request(app).post('/api/draft').send({ emailId: 1 }).expect(401);
  });

  it('registers, lists only own tenant emails, and blocks cross-tenant email id', async () => {
    const agentA = request.agent(app);
    const agentB = request.agent(app);
    const pw = 'longpassword1';

    const regA = await agentA
      .post('/api/auth/register')
      .send({ email: 'alpha@tenant-it.example', password: pw })
      .expect(201);
    expect(regA.body.data?.user?.tenantKey).toBeTruthy();

    const regB = await agentB
      .post('/api/auth/register')
      .send({ email: 'beta@tenant-it.example', password: pw })
      .expect(201);

    const tenantA = regA.body.data.user.tenantKey;
    const tenantB = regB.body.data.user.tenantKey;
    expect(tenantA).not.toBe(tenantB);

    const { saveEmail } = require('../../services/emailStore.js');
    const { STATUS, TRACK } = require('../../lib/constants.js');

    const rowA = await saveEmail({
      tenantId: tenantA,
      externalMessageId: 'ext-a-1',
      threadId: null,
      fromEmail: 'c1@example.com',
      toEmail: 'biz@example.com',
      fromDisplayName: null,
      subject: 'A only',
      bodyRaw: 'Hi',
      bodyCleaned: 'Hi',
      status: STATUS.PENDING,
      track: TRACK.REVIEW,
      confidence: 0.5,
      flags: [],
      classificationReasoning: null,
      draft: 'Draft for A with enough length to be valid later.',
      metadata: {},
    });
    const rowB = await saveEmail({
      tenantId: tenantB,
      externalMessageId: 'ext-b-1',
      threadId: null,
      fromEmail: 'c2@example.com',
      toEmail: 'biz@example.com',
      fromDisplayName: null,
      subject: 'B only',
      bodyRaw: 'Hi',
      bodyCleaned: 'Hi',
      status: STATUS.PENDING,
      track: TRACK.REVIEW,
      confidence: 0.5,
      flags: [],
      classificationReasoning: null,
      draft: 'Draft for B with enough length to be valid later.',
      metadata: {},
    });

    const listA = await agentA.get('/api/emails').expect(200);
    const listB = await agentB.get('/api/emails').expect(200);
    expect(listA.body.data.emails.map((e) => e.id)).toEqual([rowA.id]);
    expect(listB.body.data.emails.map((e) => e.id)).toEqual([rowB.id]);

    await agentB.get(`/api/emails/${rowA.id}`).expect(404);
    await agentA.get(`/api/emails/${rowB.id}`).expect(404);
  });

  it('rejects invalid login without leaking internals', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@tenant-it.example', password: 'wrongpassword' })
      .expect(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.message).toMatch(/invalid/i);
    expect(JSON.stringify(res.body)).not.toMatch(/password_hash|bcrypt|sql/i);
  });

  it('forgot-password: same success shape for missing user; dev reset URL only when user exists (non-prod)', async () => {
    const ghost = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'ghost@tenant-it.example' })
      .expect(200);
    expect(ghost.body.success).toBe(true);
    expect(ghost.body.data?.message).toBeTruthy();
    expect(ghost.body.data?.devResetUrl).toBeUndefined();

    const pw = 'longpassword1';
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'resetflow@tenant-it.example', password: pw })
      .expect(201);
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'resetflow@tenant-it.example' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data?.devResetUrl).toMatch(/reset\?token=/);
  });

  it('returns 409 when registering duplicate email', async () => {
    const pw = 'longpassword1';
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@tenant-it.example', password: pw })
      .expect(201);
    const dup = await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@tenant-it.example', password: pw })
      .expect(409);
    expect(dup.body.error?.code).toBe('exists');
  });

  it('allows password login for ten distinct registered users (launch QA)', async () => {
    const pw = 'longpassword1';
    for (let i = 1; i <= 10; i += 1) {
      const email = `ten-login-${i}@tenant-it.example`;
      await request(app)
        .post('/api/auth/register')
        .send({ email, password: pw })
        .expect(201);
    }
    for (let i = 1; i <= 10; i += 1) {
      const agent = request.agent(app);
      const email = `ten-login-${i}@tenant-it.example`;
      const login = await agent
        .post('/api/auth/login')
        .send({ email, password: pw })
        .expect(200);
      expect(login.body.success).toBe(true);
      const inbox = await agent.get('/api/emails').expect(200);
      expect(inbox.body.success).toBe(true);
    }
  });
});

describe('Knowledge tenant isolation', () => {
  it('does not expose another tenant KB file list', async () => {
    const agentA = request.agent(app);
    const agentB = request.agent(app);
    const pw = 'longpassword1';
    await agentA
      .post('/api/auth/register')
      .send({ email: 'kb-a@tenant-it.example', password: pw })
      .expect(201);
    await agentB
      .post('/api/auth/register')
      .send({ email: 'kb-b@tenant-it.example', password: pw })
      .expect(201);
    const text = 'Tenant A secret pricing is ninety-nine dollars flat.';
    await agentA
      .post('/api/knowledge/upload')
      .attach('file', Buffer.from(text, 'utf8'), {
        filename: 'pricing-a.txt',
        contentType: 'text/plain',
      })
      .expect(201);
    const listB = await agentB.get('/api/knowledge/files').expect(200);
    expect(listB.body.data?.files?.length ?? 0).toBe(0);
    const listA = await agentA.get('/api/knowledge/files').expect(200);
    expect(listA.body.data?.files?.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});

describe('POST /api/knowledge/upload', () => {
  it('accepts a txt file and persists chunks', async () => {
    const text =
      'Bounce house weekday $199. Weekend $249. Generator add-on $75.\n\nDelivery within 15 miles included.';
    const res = await request(app)
      .post('/api/knowledge/upload')
      .set('x-inboxpilot-machine-key', MACHINE)
      .attach('file', Buffer.from(text, 'utf8'), {
        filename: 'pricing.txt',
        contentType: 'text/plain',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data?.file?.id).toBeDefined();
    expect(Number(res.body.data?.file?.chunk_count || 0)).toBeGreaterThan(0);

    const list = await request(app)
      .get('/api/knowledge/files')
      .set('x-inboxpilot-machine-key', MACHINE)
      .expect(200);
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

  it('skips ingest when grant is unknown and WEBHOOK_DENY_UNKNOWN_GRANT is true', async () => {
    const prev = process.env.WEBHOOK_DENY_UNKNOWN_GRANT;
    process.env.WEBHOOK_DENY_UNKNOWN_GRANT = 'true';
    try {
      const payload = buildMessageWebhookPayload({
        id: 'ext-unknown-grant',
        grantId: 'grant-not-in-database-xyz',
      });
      const body = JSON.stringify(payload);
      const sig = signNylasBody(
        process.env.NYLAS_WEBHOOK_SECRET,
        Buffer.from(body, 'utf8')
      );
      const before = (
        await pool.query(`SELECT COUNT(*)::int AS n FROM emails`)
      ).rows[0].n;
      const res = await request(app)
        .post('/api/webhook')
        .set('x-nylas-signature', sig)
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(200);
      expect(res.body.data?.skipped).toBe(true);
      expect(res.body.data?.reason).toBe('unknown_grant');
      const after = (
        await pool.query(`SELECT COUNT(*)::int AS n FROM emails`)
      ).rows[0].n;
      expect(after).toBe(before);
    } finally {
      if (prev === undefined) delete process.env.WEBHOOK_DENY_UNKNOWN_GRANT;
      else process.env.WEBHOOK_DENY_UNKNOWN_GRANT = prev;
    }
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
      .set('x-inboxpilot-machine-key', MACHINE)
      .expect(200);
    expect(getRes.body.data?.email?.id).toBe(emailId);

    const res = await request(app)
      .post('/api/send')
      .set('x-inboxpilot-machine-key', MACHINE)
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

    const dupSend = await request(app)
      .post('/api/send')
      .set('x-inboxpilot-machine-key', MACHINE)
      .send({
        emailId,
        draft:
          'Thank you for your message. Here is our official reply with enough characters to pass validation checks easily.',
      })
      .expect(409);
    expect(dupSend.body.error?.code).toBe('already_sent');
  });
});
