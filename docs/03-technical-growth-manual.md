# Signova Technical Growth Manual

**Audience:** CTO, senior engineers, infrastructure partners  
**Deliverable:** Technical scalability — architecture, growth path, servers, database, security, performance, monitoring, analytics, DR  
**Version:** 1.0 — July 2026  
**System:** Signova member API (`fx-signals-server`)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture](#2-current-architecture)
3. [Database Structure](#3-database-structure)
4. [Server Requirements](#4-server-requirements)
5. [Security](#5-security)
6. [Performance Optimization](#6-performance-optimization)
7. [Monitoring](#7-monitoring)
8. [Analytics](#8-analytics)
9. [Future Scaling](#9-future-scaling)
10. [Disaster Recovery](#10-disaster-recovery)
11. [Capacity Planning Cheat Sheet](#11-capacity-planning-cheat-sheet)
12. [Appendix — Dependency Map](#12-appendix--dependency-map)

---

## 1. Executive Summary

Signova’s backend is a **Node.js / Express / TypeScript** monolithic API backed by **MongoDB**, deployed on **Render**, with critical integrations to an **admin signal server**, **Paystack**, **Dextopus**, **Resend**, and market-data / AI vendors.

**Today’s strengths**

- Clear layered code (routes → controllers → services → models)
- Caching for signals, FCSAPI, and stocks
- Idempotent payment apply and alert fan-out
- Cookie + Bearer JWT with token blacklist

**Today’s constraints (scale triggers)**

- Single web process also runs the Dextopus deposit poller
- OTP rate limits are **in-memory** (not shared across instances)
- No in-repo CI, APM, or formal metrics pipeline
- Signals of truth live on a remote admin server (availability coupling)
- FCSAPI soft monthly call budget (~500)

This manual documents the as-built system and a pragmatic path to grow without premature complexity.

---

## 2. Current Architecture

### 2.1 Component Diagram

```
                    ┌──────────────────────┐
                    │   Frontend apps      │
                    │   (CORS allowlist)   │
                    └──────────┬───────────┘
                               │ HTTPS + cookies/Bearer
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Signova Server (Render web service)                         │
│  Express + Helmet + Morgan + CookieParser                    │
│                                                              │
│  /auth /signals /journal /payments /tv /analysis             │
│  /stocks /youtube /chart-presets /referrals /admin           │
│                                                              │
│  Background: DextopusDepositSyncService (interval poll)      │
└───────┬───────────────┬──────────────────┬───────────────────┘
        │               │                  │
        ▼               ▼                  ▼
   MongoDB Atlas    Admin Server      External APIs
   (primary data)   (elite signals,   Paystack, Dextopus,
                    alert publisher)  Resend, FCSAPI,
                                      Finnhub, AV, OpenAI,
                                      Anthropic
```

### 2.2 Request Path

1. TLS terminated at host  
2. CORS origin check against `FRONTEND_URLS`  
3. Special-case: `/payments/webhook` uses **raw body** for HMAC  
4. JSON body parser for remaining routes  
5. Route → optional `verifyToken` / `requireAdmin` / secret headers  
6. Controller → Service → Model / HTTP client  
7. Central `errorHandler` shapes failures  

### 2.3 Integration Contracts

| Peer | Direction | Auth |
|------|-----------|------|
| Admin server | Signova **reads** approved signals | `x-service-secret` = `SIGNALS_READ_SECRET` |
| Admin server | Admin **posts** alerts | `x-alert-secret` |
| Admin server | Admin **invalidates** cache | `x-invalidate-secret` |
| Paystack | Webhook inbound | HMAC `x-paystack-signature` |
| Dextopus | Signova polls / creates deposits | Provider API + treasury config |
| Google | Token audience verify | `GOOGLE_CLIENT_ID` |
| Resend | Outbound email | API key |

### 2.4 Trust Boundaries

| Zone | Contents |
|------|----------|
| Public internet | Frontend, Paystack webhooks, public GETs |
| Authenticated member | JWT-scoped personal data |
| Admin allowlist | Affiliate ops |
| Machine-to-machine | Shared secrets with admin server |
| Vendor | Keys for market/AI/payments — never exposed to clients |

### 2.5 Process Model

**Current:** One Node process serves HTTP **and** runs deposit polling.

Implications:

- Deploy restarts interrupt in-flight polls (recover on next interval)
- Horizontal scale multiplies pollers unless leader-elected
- Memory rate-limit maps are **per instance**

---

## 3. Database Structure

### 3.1 Technology

- **MongoDB** via **Mongoose 9**
- Connection bootstrap: `src/config/db.ts`
- URI: `MONGO_URI`

### 3.2 Collections (Logical Schema)

#### Identity & Access

| Collection | Purpose | Key indexes / notes |
|------------|---------|---------------------|
| `User` | Accounts, plan, prefs, wallets, referral | Unique `email`; sparse unique `username`, `googleId`, `referralCode` |
| `TokenBlacklist` | Revoked JWTs | TTL on `expiresAt` |

#### Trading Activity

| Collection | Purpose |
|------------|---------|
| `SignalPlay` | User played a signal — index `{ userId, playedAt }` |
| `Journal` | Properties, views, rows; partial unique default journal per user |
| `SignalAlertNotification` | Idempotency for alert emails — unique `(signalId, alertType)` |

#### Monetization

| Collection | Purpose |
|------------|---------|
| `Transaction` | Paystack checkouts — unique `paystackReference` |
| `Deposit` | Dextopus funding/upgrade — unique `depositRequestId`, status machine |
| `ReferralEarning` | Referral attribution — unique `sourceTransactionId` |
| `SigcoinLedger` | Append-only SIGcoin movements |
| `AffiliatePayout` | Admin-recorded payouts |

#### Caching / Quotas

| Collection | Purpose |
|------------|---------|
| `SignalsCache` | Approved-signal cache + TTL |
| `FcsapiCache` | Pair candle/signal cache + TTL |
| `FcsapiUsage` | Monthly call counter |
| `StocksCache` | Recommendations cache + TTL |

#### Charts

| Collection | Purpose |
|------------|---------|
| `ChartLayout` | Saved TV layouts |
| `StudyTemplate` | Study templates (+ one default per user) |
| `DrawingTemplate` | Drawing tool templates |
| `ChartTemplate` | Chart templates |

#### Content & ML-ish

| Collection | Purpose |
|------------|---------|
| `YoutubeLink` | Education CMS entries |
| `Prediction` | Stock prediction + 1536-d embedding; designed for Atlas Vector Search (`prediction_vector_index`) |

### 3.3 Relationship Sketch

```
User 1──* Journal
User 1──* SignalPlay
User 1──* Transaction
User 1──* Deposit
User 1──* ChartLayout / StudyTemplate / DrawingTemplate / ChartTemplate
User 1──* SigcoinLedger / AffiliatePayout
User *──1 User (referredBy)

Journal *── rows (embedded) optionally → SignalPlay / signal id
```

**Signals themselves** are not a first-class durable collection of record; they are sourced from the admin server and optionally cached.

### 3.4 Data Growth Characteristics

| Data | Growth driver | Retention idea |
|------|---------------|----------------|
| Users | Marketing | Indefinite |
| SignalPlay | Active traders × signals | Keep; archive cold history later |
| Journal rows | Heavy journal users | Keep; consider grid pagination / archival |
| Transactions / Deposits | Checkout volume | Keep (audit) |
| Caches | Bounded by TTL indexes | Self-expiring |
| TokenBlacklist | Logouts | TTL until JWT expiry |
| Alert notifications | Signal events | Keep for idempotency / audit |
| Predictions | Stock AI runs | Prune or sample; vector index cost |

### 3.5 Migration Approach

- Prefer **additive** fields with defaults
- Avoid renames without dual-read windows
- Create indexes in Atlas during low traffic; document in PR
- For Vector Search: follow model comments to create Atlas index `prediction_vector_index`

---

## 4. Server Requirements

### 4.1 Current (Minimum Viable Production)

| Resource | Recommendation |
|----------|----------------|
| **Compute** | Render Node web service, 1 instance, ≥512MB RAM to start; 1GB preferred once AI + chart traffic grows |
| **Node** | LTS (20+) |
| **MongoDB** | Atlas M10+ for production (backups, PITR); M0 only for sandbox |
| **Outbound egress** | Required to admin server, Paystack, Dextopus, Resend, FCSAPI, Finnhub, AV, OpenAI, Anthropic, Google |
| **Inbound** | HTTPS; webhook endpoints publicly reachable |

### 4.2 Environment Classes

| Class | API | DB | Notes |
|-------|-----|-----|-------|
| Dev | Laptop | Local Mongo / shared Atlas | Test OTP OK |
| Staging | Small Render | Atlas M0/M2 | Paystack test keys |
| Prod | Render paid | Atlas M10+ | Live keys; no public test OTP |

### 4.3 Network / DNS

- Stable custom domain for API (webhooks + frontend CORS)
- `FRONTEND_URLS` must list every browser origin
- Admin server URL private or firewalled if possible; still requires shared secret

### 4.4 Vertical Headroom Before Redesign

Expect comfortable headroom while concurrent members are in the **low thousands**, if:

- Signal cache hit rate stays high
- FCSAPI usage stays under monthly soft cap
- Mongo indexes used for plays/journals/users
- Email blasts are paced (already batched)

Scale-out triggers are listed in §9.

---

## 5. Security

### 5.1 Authentication & Session

| Control | Implementation |
|---------|----------------|
| Passwordless OTP | Email OTP, 10-minute expiry, rate limited |
| Google OAuth | Access token audience binding to `GOOGLE_CLIENT_ID` (fail-closed) |
| JWT | 7-day HS256 (`JWT_SECRET`) |
| Transport of token | HttpOnly cookie `auth_token` (+ Bearer) |
| Cookie flags | `secure` + `sameSite: none` in production |
| Logout | Persist token in `TokenBlacklist` until TTL |
| Request gate | Verify signature + blacklist + user still exists |

### 5.2 Authorization

| Capability | Gate |
|------------|------|
| Member resources | JWT `userId` ownership checks in services |
| Affiliate admin | `ADMIN_EMAILS` allowlist middleware |
| Alert / invalidate | Shared header secrets |
| Signal read from admin | Outbound service secret |

**Plan gating:** stored as `plan` / `proPlanExpiry`; enforcement primarily client-side today. Server-side entitlement checks should be added before charging for exclusive signal payloads if abuse appears.

### 5.3 Payments Security

- Paystack webhook verifies HMAC over **raw** body
- Successful payment application must remain **idempotent**
- Never log full authorization URLs with sensitive query remnants if present
- Dextopus treasury recipient / chain / asset configured via env — treat as high sensitivity

### 5.4 HTTP Hardening

- `helmet()` enabled
- CORS allowlist (credentials true)
- OTP send/verify rate limits (per email/IP, in-memory)

### 5.5 Secrets Management

- All secrets via environment / Render env groups
- `.env` gitignored; `.env.example` documents names only
- Rotate: `JWT_SECRET` (forces re-login), Paystack keys, signal secrets (coordinate with admin server), Resend

### 5.6 Data Protection

| Data | Handling |
|------|----------|
| Email / phone | Least privilege in admin tools; avoid verbose logs |
| Avatar data-URLs | Can be large — watch payload size limits |
| Journal content | Private to userId |
| OTP codes | Short-lived; hashed storage is a future improvement |
| PII in analytics | Hash or omit identifiers |

### 5.7 Known Soft Spots (Prioritize)

1. In-memory rate limits ineffective behind multi-instance LB  
2. Server-side Pro enforcement incomplete for signals  
3. SL emails paused — confirm intentional before re-enabling  
4. Test OTP must never be enabled on open production  
5. No WAF / bot protection documented at app layer  

---

## 6. Performance Optimization

### 6.1 Caching Strategy (As Built)

| Cache | TTL / behavior | Benefit |
|-------|----------------|---------|
| `SignalsCache` | ~5 minutes; manual invalidate | Shields admin server |
| `FcsapiCache` | ~15 minutes | Cuts FCSAPI spend / latency |
| `StocksCache` | TTL-based | Softens Finnhub/AV/OpenAI cost |
| HTTP CDN | Not used for API JSON | Frontends can cache public GETs carefully |

### 6.2 External Call Budgets

| Vendor | Constraint | Mitigation |
|--------|------------|------------|
| FCSAPI | ~500 calls/month tracked in `FcsapiUsage` | Cache; monitor `/signals/usage` |
| Resend | Provider rate limits | Batched alert sends (`p-limit`) |
| OpenAI / Anthropic | Cost + latency | Cache stocks; AI journal on-demand only |
| Admin server | Availability | Cache + invalidate |

### 6.3 Database Performance

**Do**

- Keep compound indexes aligned to query patterns (`userId + playedAt`, unique payment refs)
- Use pagination on history/admin lists
- Lean projections for list endpoints

**Avoid**

- Unbounded journal row arrays without pagination at large sizes (document size risk)
- Embedding huge chart `content` blobs without size guards
- Collection scans on email OTP paths (email is uniquely indexed)

### 6.4 Application Performance Tips

- Prefer cache hit on `/signals/approved` under launch spikes
- Keep alert fan-out asynchronous relative to admin’s webhook SLA (respond after enqueue semantics / bounded send)
- Deposit poll interval (`DEXTOPUS_STATUS_POLL_INTERVAL_MS`, default 15s) — do not set aggressively low at scale
- Helmet/morgan fine; consider reducing morgan noise in prod (`combined` with sampling)

### 6.5 Frontend-Adjacent Gains

- Compose dashboard widgets with stale-while-revalidate
- Use public signals teaser on marketing pages without JWT
- Lazy-load journal AI and chart templates

---

## 7. Monitoring

### 7.1 Current State

| Signal | Available today |
|--------|-----------------|
| Process liveness | `GET /health` |
| Request logs | Morgan `dev` (swap to structured prod logs) |
| Deploy health | Render dashboards |
| Ad-hoc | Console logs (`[signal-alert]`, deposit sync) |

**Gap:** No centralized APM, metrics, or alert routing in-repo.

### 7.2 Target Monitoring Stack (Recommended)

| Layer | Suggestion |
|-------|------------|
| Uptime | Ping `/health` every 60s (Better Uptime / Checkly / Render native) |
| APM / errors | Sentry or OpenTelemetry → Grafana/Honeycomb |
| Metrics | Request rate, latency p95, 5xx, webhook failures, deposit lag |
| Logs | Structured JSON logs → Axiom / Logtail / Datadog |
| Mongo | Atlas alerts: connections, CPU, disk, replication lag |
| Payments | Paystack dashboard + mismatch alerts vs `Transaction` statuses |
| Email | Resend bounce/complaint webhooks |

### 7.3 SLIs / SLOs (Starting Point)

| SLI | Target SLO |
|-----|------------|
| Availability (`/health` success) | 99.5% monthly |
| Auth OTP verify success (excluding user error) | 99% |
| Approved signals p95 latency (cache hit) | < 300ms |
| Approved signals p95 (cache miss) | < 2s |
| Paystack webhook processing success | 99.9% |
| Deposit success eventual consistency | < 15 min from chain confirm (vendor-dependent) |

### 7.4 Alerting Rules (Minimum)

| Alert | Condition |
|-------|-----------|
| API down | Health fail × 2 |
| Error spike | 5xx rate > 2% for 5 min |
| Payment apply failures | > N failed verifies / 15 min |
| Deposit stuck | `awaiting_funds`/`processing` older than threshold |
| FCSAPI budget | Usage > 80% of monthly soft cap |
| Admin unreachable | Cache miss failures rising |

### 7.5 Instrumentation Hooks (Engineering Work)

Add later without redesign:

1. Middleware timers per route prefix  
2. Counters for alert sent/failed  
3. Gauge for open deposits by status  
4. Trace IDs in logs for webhook ↔ user correlation  

---

## 8. Analytics

### 8.1 Product Analytics (What to Measure)

| Funnel | Events (frontend + backend) |
|--------|-----------------------------|
| Acquisition | OTP sent, verified, Google success, referral attached |
| Activation | First signal view, first play, first journal row |
| Retention | D7/D30 plays, win-rate views |
| Revenue | Upgrade start, pay success, deposit success, plan expiry |
| Referral | Share clicks, subscribed referral credited, SIGcoin balance |
| Engagement | Alert email open/click (Resend), chart preset saves, AI asks |

### 8.2 Backend-Derived Metrics

Queryable today from Mongo without a warehouse:

```
Users by plan
New users / day
Pro activations / day (Transactions/Deposits success)
SIGcoins issued / week
SignalPlay volume / day
Alert notifications by alertType
FcsapiUsage.month.count
```

### 8.3 Recommended Pipeline (Growth Stage)

```
API events ──▶ Segment / PostHog / Mixpanel (client)
     │
     └──▶ Warehouse (BigQuery/Snowflake) via Atlas → ETL
              │
              └── BI (Metabase / Mode)
```

Keep PII minimized; prefer user UUID over email in analytics tools.

### 8.4 Experimentation

Until a flag system exists:

- Frontend A/B for pricing UX
- Backend env toggles for risky email types (e.g. re-enable SL alerts gradually)
- Measure: upgrade conversion, alert unsubscribe rate, play-through rate

---

## 9. Future Scaling

### 9.1 Scale Triggers → Actions

| Trigger | Action |
|---------|--------|
| CPU/RAM near limit on one Render instance | Vertical upgrade first |
| Need ≥2 instances | Move rate limits to Redis; elect deposit-sync leader or separate worker |
| Admin server latency spikes | Longer signal cache + read replicas / CDN for public teaser |
| Mongo CPU / slow queries | Index audit; Atlas tier up; separate analytics reads |
| Email volume high | Dedicated queue (SQS/BullMQ) for fan-out |
| Journal documents huge | Normalize rows collection; paginate heavily |
| Global users / multi-region | Region-aware Mongo; edge caching for public GETs |
| Strict Pro enforcement | Middleware checking `plan`+`proPlanExpiry` on premium routes |

### 9.2 Target Architecture (Next 12–24 Months)

```
                 Load Balancer
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
     API instances            Worker instance
     (stateless HTTP)         (deposit sync,
                               email fan-out,
                               cache warmers)
          │                       │
          └───────────┬───────────┘
                      ▼
              Redis (rate limit, locks, queues)
                      │
                      ▼
                 MongoDB Atlas
              (primary + optional analytics node)
```

### 9.3 Extraction Candidates (Only When Painful)

| Extract | When |
|---------|------|
| Notification worker | Alert blasts delay webhooks |
| Billing service | Complex tax/regions/multi-provider |
| Chart data service | TV traffic dwarfs core API |
| Read-only signals BFF | Extremely high feed QPS |

Avoid microservice sprawl while a well-factored monolith still fits the team.

### 9.4 Scalability of Specific Domains

**Signals**

- Cache + invalidate already healthy
- Add ETag / `If-None-Match` for clients
- Optional SSE/WebSocket for near-real-time (ops cost high)

**Payments**

- Keep idempotent apply as sacred
- Outbox pattern if dual-writes expand
- Separate ledger service only at high finance complexity

**Journal + AI**

- Rate-limit AI endpoints per user
- Cap row count / property count
- Stream Claude responses if UX needs it

**Referrals**

- Append-only ledger scales; payout batch jobs later

---

## 10. Disaster Recovery

### 10.1 Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Render outage | Full API down | Low–med | Status page; multi-region later |
| Mongo data loss | Catastrophic | Low (with Atlas) | Automated backups + PITR |
| Secret leak | Account/payment abuse | Med | Rotation runbooks; least privilege |
| Admin server down | Stale/empty signals | Med | Cache serve-stale; user messaging |
| Paystack down | No card upgrades | Med | Dextopus path; delay messaging |
| Bad deploy | Partial outage | Med | Rollback SOP (Ops Manual §11) |
| Accidental mass email | Trust damage | Low | Idempotency + paused types + dry-run scripts |

### 10.2 Backups

| Asset | Method | RPO target | RTO target |
|-------|--------|------------|------------|
| MongoDB | Atlas continuous backup / PITR | ≤ 1 hour (aim minutes) | ≤ 4 hours |
| Source code | Git remote | ≈ 0 | Minutes (redeploy) |
| Env secrets | Render / password manager export | ≈ 0 | ≤ 1 hour |
| Email templates | In Git | ≈ 0 | Redeploy |

**Practice:** Quarterly restore drill of a staging cluster from Atlas snapshot.

### 10.3 Recovery Playbooks (Short)

**A. API process crash-loop**

1. Check Render logs / last deploy  
2. Rollback deploy  
3. Confirm `/health`  
4. Re-test auth + payments webhook  

**B. Database unavailable**

1. Atlas status  
2. Fail over / restore if needed  
3. Keep API in maintenance mode if writes unsafe  
4. Replay missed webhooks from Paystack if applicable  

**C. Ransomware / destructive delete**

1. Freeze credentials  
2. Restore to new cluster from clean backup  
3. Rotate all secrets  
4. Audit `User` / `Transaction` integrity  

**D. Signal pipeline down**

1. Confirm admin health  
2. Serve last good `SignalsCache` if present  
3. Pause alert dependency messaging  
4. Invalidate only when admin recovered  

### 10.4 Business Continuity Notes

- Email OTP login depends on Resend — have a break-glass admin path (existing JWT sessions continue until expiry)
- Pro members retain local plan fields even if Paystack is down (no new upgrades)
- Deposit poller restart after outage should reconcile pending deposits via status API

### 10.5 RTO/RPO Summary

| Scenario | RPO | RTO |
|----------|-----|-----|
| App deploy rollback | 0 data | 15–30 min |
| Mongo PITR | Minutes | 1–4 h |
| Full rebuild new host | 0 (Git) + DB restore | 4–8 h |
| Vendor (Resend/Paystack) | N/A | Vendor-dependent; use alternate path |

---

## 11. Capacity Planning Cheat Sheet

| Growth signal | Early action | Later action |
|---------------|--------------|--------------|
| Active users ↑ | Vertical plan | Horizontal API + Redis |
| Signal launches viral | Cache + invalidate | Edge cache public teaser |
| Journal power users | Caps + pagination | Rows collection split |
| Affiliate program scales | Admin tooling polish | Payout automation + fraud checks |
| AI usage cost ↑ | Per-user rate limits | Dedicated budget + model tiering |
| Multi-region users | CDN static; API single region OK | Geo Mongo / regional API |

**Cost levers:** FCSAPI plan tier, OpenAI/Claude token usage, Atlas tier, Render instance size, Resend volume.

---

## 12. Appendix — Dependency Map

| Dependency | Failure mode | Product impact |
|------------|--------------|----------------|
| MongoDB | Hard down | Full outage |
| Admin server | Soft/hard | Empty/stale signals; no new alerts |
| Paystack | Soft | Card upgrade path broken |
| Dextopus | Soft | Crypto funding/upgrade delayed |
| Resend | Soft | OTP & alerts delayed |
| Google | Soft | Google login only |
| FCSAPI | Soft | Pair history / some chart data degrade |
| Finnhub / AV | Soft | Stocks widgets degrade |
| OpenAI | Soft | Stock narrative fallback |
| Anthropic | Soft | Journal AI unavailable |

---

## Related Documents

- [Product Manual](./01-product-manual.md) — user-facing behavior  
- [Engineering Operations Manual](./02-engineering-operations-manual.md) — how we ship and recover  

---

*End of Technical Growth Manual.*
