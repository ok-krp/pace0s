# PaceOS — SaaS production architecture

## Commercial model

Recommended launch catalog:

| Plan | Monthly | Annual | Main purpose |
| --- | ---: | ---: | --- |
| Trial | 7 days | 7 days | Full product trial, no permanent free tier |
| Plus | €9.99 | €99 | Daily power users |
| Pro | €19.99 | €199 | Main paid plan, intensive AI |
| Coach | €39.99 | €399 | Sharing, coach/family workflows |

The annual prices intentionally give roughly two months free.

The application must never decide access from a client-side price or a local flag. Stripe is the billing source of truth for paid subscriptions; Supabase mirrors the subscription state through signed webhooks; server functions enforce entitlements. The application grants one seven-day trial per account and per device signal. There is no permanent Free plan.

## Billing architecture

\`\`\`
Pace client
  -> authenticated server function
  -> Stripe Checkout / Customer Portal
  -> Stripe webhook
  -> Supabase billing_events (idempotency)
  -> Supabase billing_subscriptions
  -> server-side entitlement checks
  -> UI reflects the resulting state
\`\`\`

Rules:

1. Never trust a client-supplied plan for authorization.
2. Never expose Stripe secret keys or Supabase secret keys to the browser.
3. Every Stripe event is stored by event ID before processing, so retries cannot duplicate a subscription update.
4. Customers can manage upgrades, downgrades, payment methods and cancellation through Stripe Customer Portal.
5. Cancellation defaults to end-of-period access rather than immediate deletion.
6. Stripe outages must not erase local application data or trial data.
7. Billing is additive: a user without a valid paid subscription falls back to Free.

## Data ownership

- Supabase Postgres: canonical user/account/domain data, subscription mirror, billing event ledger.
- Supabase Storage: private user files and application media that need database-linked access control.
- Vercel: web delivery, server functions, deployment and edge delivery.
- Stripe: payment methods, invoices, subscription lifecycle and payment state.
- Device local storage: offline cache/outbox only; never the source of truth for paid access.
- Native Flutter: platform UI, offline cache, HealthKit/Health Connect and device capabilities.

Do not introduce a second database for normal Pace user data merely to scale. PostgreSQL remains the canonical relational store until measurements demonstrate a real bottleneck.

## Safe change protocol

Every production change follows:

1. Branch from \`main\`.
2. Change code and, when needed, add a forward-only Supabase migration.
3. Run TypeScript, lint and production build in GitHub Actions.
4. Deploy a Vercel preview.
5. Verify the route and critical flow in a browser.
6. Inspect Vercel runtime errors and Supabase advisors.
7. Merge only after the preview is healthy.
8. Production deployment remains rollbackable to the previous Vercel deployment.

Database rules:

- Never rewrite historical migrations.
- Never drop user data as part of a UI migration.
- Add nullable columns before making them required.
- For destructive changes, use expand -> migrate -> switch -> contract.
- Keep event/idempotency keys on payment and AI mutation paths.

## Scaling target

The architecture is intentionally designed around a few thousand paying subscribers rather than one database per customer. The product has no permanent free tier; the seven-day trial is an acquisition mechanism and is enforced server-side.

At 1,000 paying users, a single Supabase Pro project is normally a reasonable starting point. Supabase Pro currently starts at $25/month and includes 8 GB database disk, 250 GB uncached egress, 250 GB cached egress and 100k MAU before overage; compute is usage-based. Review usage before adding read replicas or separate services.

Vercel Pro uses a usage-credit model and Spend Management. Keep a hard monthly spend ceiling and alerts enabled; do not allow an AI or traffic spike to silently become an infrastructure bill.

For large media, keep binary files out of Postgres. Store them in object storage and keep only metadata and ownership references in Postgres.

## Revenue planning

A €1,000/month personal net-income target is not a guaranteed outcome; tax depends on the legal structure, salary/dividend mix and personal situation.

For planning, use a conservative operating model instead of treating subscription revenue as take-home pay.

Example at €19.99/month:

- 100 paid subscribers: €1,999 gross MRR
- 150 paid subscribers: €2,998.50 gross MRR
- 500 paid subscribers: €9,995 gross MRR
- 1,000 paid subscribers: €19,990 gross MRR
- 4,170 paid subscribers: about €1M gross ARR at that average price

These figures are revenue before VAT, payment fees, infrastructure, AI inference, refunds and taxes. Conversion rate and retention matter as much as headline price.

## AI cost control

Cloud AI is the variable cost that can destroy SaaS margins if it is uncapped.

Use plan-level monthly quotas:

- Free: 20 cloud AI actions/month
- Plus: 60
- Pro: 250
- Coach: 750

Local AI, where supported by the device, should not consume the cloud quota.

The quota must be enforced server-side and usage should be recorded monthly. Never rely on a disabled button or client counter for enforcement.

## Native application strategy

The repository already contains a real Flutter native application track plus Android Health Connect and an iOS HealthKit bridge. It is not yet equivalent to saying the consumer product is fully shipped in both stores.

The migration path is:

1. Keep web/PWA production stable.
2. Reach domain parity in Flutter.
3. Add native auth/session handling and offline outbox.
4. Add subscription entitlements to the native client using the same server contract.
5. Add store-specific billing only where required by Apple/Google rules; web Stripe remains the primary web billing path.
6. Sign and distribute Android/iOS release builds.
7. Retire individual web-only implementations only after parity tests pass.

The native application must not become a WebView wrapper around the website.

## Operational objective

The goal is not merely "1,000 subscriptions". The system should remain operable with:

- 1k paid users: one production Supabase project + Vercel production + Stripe
- 5k paid users: optimize queries, caching, AI quotas and media egress before adding infrastructure
- 10k+ paid users: introduce read-heavy caching, background jobs/queues and workload isolation where metrics justify it
- 50k+ users: evaluate database read replicas, partitioning, dedicated compute and separate AI workloads
- €1M+ ARR: negotiate payment/infrastructure volume pricing and maintain explicit unit economics per plan

Every scaling step is triggered by measured CPU, query latency, egress, storage, AI cost/user and error-rate data — not by assumptions.
