INSERT INTO tenants (tenant_key, display_model, auto_send_threshold, settings)
VALUES (
  'default',
  'gpt-4o',
  0.90,
  '{
    "autoSendHighConfidence": true,
    "alwaysFlagDiscountRequests": false,
    "ragOnlyMode": true,
    "feedbackLoopLearning": true
  }'::jsonb
)
ON CONFLICT (tenant_key) DO NOTHING;

-- Demo workspace email (only when none set yet)
UPDATE tenants
SET business_email = 'ops@demo.inboxpilot.local'
WHERE tenant_key = 'default'
  AND (business_email IS NULL OR TRIM(business_email) = '');

-- Sample emails + audit trail so a fresh install feels like a real product (idempotent)
INSERT INTO emails (
  tenant_id,
  external_message_id,
  from_email,
  to_email,
  from_display_name,
  subject,
  body_cleaned,
  track,
  confidence,
  status,
  flags,
  classification_reasoning,
  draft,
  final_reply,
  received_at,
  sent_at
)
SELECT * FROM (VALUES
  (
    'default',
    'inboxpilot-seed-review-1',
    'jordan.lee@enterprise.io',
    'ops@demo.inboxpilot.local',
    'Jordan Lee',
    'Volume pricing for 200 seats?',
    'Hi — we are evaluating InboxPilot for ~200 support agents. Can you share annual pricing and onboarding timeline? We need SSO and a BAA.'::text,
    'review'::varchar(16),
    0.72::numeric,
    'pending'::varchar(24),
    '["Pricing negotiation", "Non-standard setup"]'::jsonb,
    'Confidence is below the auto-send threshold (90%). Message references enterprise scale and legal (BAA) which typically need human judgment. Knowledge base has no matching enterprise pricing tier.'::text,
    'Thanks for your interest in InboxPilot. For 200 seats we recommend our Enterprise plan with SSO and a standard BAA. I can connect you with our solutions team — what is a good time this week?'::text,
    NULL::text,
    NOW() - INTERVAL '2 hours',
    NULL::timestamptz
  ),
  (
    'default',
    'inboxpilot-seed-review-2',
    'sam@retailer.com',
    'ops@demo.inboxpilot.local',
    'Sam Rivera',
    'Refund for last month''s overcharge',
    'I was double-billed in February. Please refund the second charge on invoice #88421.'::text,
    'review'::varchar(16),
    0.58::numeric,
    'pending'::varchar(24),
    '["Refund request", "Low confidence"]'::jsonb,
    'Refund and billing disputes are flagged for human review. Classifier confidence is low; no policy snippet in KB explicitly covers invoice #88421.'::text,
    'I am sorry for the billing trouble. I have escalated this to our billing team and they will confirm the duplicate charge and process a refund within 2 business days.'::text,
    NULL::text,
    NOW() - INTERVAL '45 minutes',
    NULL::timestamptz
  ),
  (
    'default',
    'inboxpilot-seed-review-3',
    'alex@startup.dev',
    'ops@demo.inboxpilot.local',
    'Alex Kim',
    'Custom SLA terms?',
    'Can we get a 99.99% uptime SLA in the contract? Our legal team needs this language.'::text,
    'review'::varchar(16),
    0.68::numeric,
    'pending'::varchar(24),
    '["Contract / SLA", "Missing KB info"]'::jsonb,
    'Non-standard SLA language detected. KB contains standard SLA only; contract changes require human approval.'::text,
    'Thanks for asking. Standard contracts include 99.9% uptime. Custom 99.99% terms need legal review — I am looping in our contracts team to follow up.'::text,
    NULL::text,
    NOW() - INTERVAL '20 minutes',
    NULL::timestamptz
  ),
  (
    'default',
    'inboxpilot-seed-auto-1',
    'help@smallbiz.co',
    'ops@demo.inboxpilot.local',
    'Jamie Chen',
    'What are your business hours?',
    'Quick question — what timezone are you in and when can I reach support?'::text,
    'auto'::varchar(16),
    0.94::numeric,
    'sent'::varchar(24),
    '[]'::jsonb,
    'High-confidence FAQ-style question. Content matches knowledge base “Support hours” section. No risk flags; above auto-send threshold.'::text,
    NULL::text,
    'Thanks for reaching out. Our support team is available Monday–Friday, 9am–6pm US Eastern. You can also reply to this thread anytime and we will respond within one business day.'::text,
    NOW() - INTERVAL '26 hours',
    NOW() - INTERVAL '26 hours'
  ),
  (
    'default',
    'inboxpilot-seed-auto-2',
    'pat@example.org',
    'ops@demo.inboxpilot.local',
    'Pat O''Neill',
    'Reset my portal password',
    'I forgot my password for the customer portal. Can you send a reset link?'::text,
    'auto'::varchar(16),
    0.91::numeric,
    'sent'::varchar(24),
    '[]'::jsonb,
    'Routine account request with clear playbook in KB. Confidence above threshold; safe to auto-send password reset instructions.'::text,
    NULL::text,
    'You can reset your password from the login page — click “Forgot password” and enter your email. If you do not receive the link within 10 minutes, let us know and we will verify your account.'::text,
    NOW() - INTERVAL '3 hours',
    NOW() - INTERVAL '3 hours'
  )
) AS v(
  tenant_id,
  external_message_id,
  from_email,
  to_email,
  from_display_name,
  subject,
  body_cleaned,
  track,
  confidence,
  status,
  flags,
  classification_reasoning,
  draft,
  final_reply,
  received_at,
  sent_at
)
WHERE NOT EXISTS (
  SELECT 1 FROM emails e WHERE e.external_message_id = v.external_message_id AND e.tenant_id = v.tenant_id
);

-- Activity / send log for auto-sent demo rows (idempotent)
INSERT INTO send_log (tenant_id, email_id, nylas_message_id, body_preview, payload_snapshot, provider_response, success)
SELECT
  e.tenant_id,
  e.id,
  'demo-nylas-' || e.external_message_id,
  LEFT(COALESCE(e.final_reply, ''), 400),
  jsonb_build_object('mode', 'auto', 'subject', e.subject, 'to', e.from_email),
  jsonb_build_object('demo', true),
  TRUE
FROM emails e
WHERE e.external_message_id IN ('inboxpilot-seed-auto-1', 'inboxpilot-seed-auto-2')
  AND NOT EXISTS (
    SELECT 1 FROM send_log sl WHERE sl.email_id = e.id AND sl.success = TRUE
  );
