# Signova Engineering Operations Manual

**Audience:** Engineers, QA, DevOps, CTO  
**Deliverable:** Development SOP — workflow, Git, testing, QA, deploy, bugs, releases, review, rollback, version control  
**Version:** 1.0 — July 2026  
**Repo:** `signova_server` (`fx-signals-server`)

---

## Table of Contents

1. [Purpose & Principles](#1-purpose--principles)
2. [Development Workflow](#2-development-workflow)
3. [Git Process](#3-git-process)
4. [Version Control](#4-version-control)
5. [Code Review Process](#5-code-review-process)
6. [Testing](#6-testing)
7. [QA](#7-qa)
8. [Bug Reporting](#8-bug-reporting)
9. [Release Cycle](#9-release-cycle)
10. [Deployment](#10-deployment)
11. [Rollback Procedure](#11-rollback-procedure)
12. [Environments & Secrets](#12-environments--secrets)
13. [On-Call / Incident Basics](#13-on-call--incident-basics)
14. [Appendix — Commands Cheat Sheet](#14-appendix--commands-cheat-sheet)

---

## 1. Purpose & Principles

This manual standardizes how we ship changes to the Signova member API safely and repeatably.

**Principles**

1. **Main stays releasable** — no long-lived broken `main`.
2. **Prefer small PRs** — easier review, smaller blast radius.
3. **Secrets never in Git** — use env / host secret store.
4. **Payments & auth changes get extra scrutiny** — money and identity paths require test evidence.
5. **Document what the code does not** — ops quirks (e.g. paused SL emails) belong in PR notes.

**Stack snapshot**

| Item | Value |
|------|-------|
| Language | TypeScript 5.3 |
| Runtime | Node.js |
| Framework | Express 4 |
| DB | MongoDB + Mongoose 9 |
| Package manager | **pnpm** (Render uses `pnpm`; lockfile present) |
| Host | Render (`render.yaml` → service `signova-server`) |
| Entry | `src/index.ts` → `dist/index.js` |

---

## 2. Development Workflow

### 2.1 Local Setup

1. Clone the repository.
2. Copy `.env.example` → `.env` and fill required values:
   - `MONGO_URI`
   - `JWT_SECRET`
   - `PAYSTACK_SECRET_KEY`
3. Install dependencies:

```bash
corepack enable
pnpm install
```

4. Ensure MongoDB is reachable (local or Atlas).
5. Start the API:

```bash
pnpm dev
```

Default port: **3001** (`PORT`).

6. Smoke-check:

```bash
curl -s http://localhost:3001/health
```

### 2.2 Day-to-Day Loop

```
Pick ticket / issue
  → Create branch from latest main
  → Implement in src/ (routes → controllers → services → models)
  → Add/adjust tests under src/tests/ when touching auth/payments/signals math
  → pnpm build && pnpm test
  → Open PR
  → Address review
  → Merge
  → Deploy (Render auto or manual promote)
  → Verify /health + critical path
```

### 2.3 Layer Conventions

| Layer | Rule |
|-------|------|
| **Routes** | Wire paths + middleware only; no business logic |
| **Controllers** | Parse/validate request; map to service; send JSON |
| **Services** | Domain rules, external APIs, transactions |
| **Models** | Schema, indexes, light virtuals — not HTTP |
| **Middleware** | Cross-cutting: auth, admin, rate limit, errors |
| **Config** | Env validation, plan prices, referral constants |

Path alias: `@/*` → `src/*` (see `tsconfig.json`).

### 2.4 Adding a New Endpoint

1. Decide mount prefix (existing router vs new).
2. Add route + auth middleware as needed.
3. Implement controller + service.
4. Update models if persistence changes.
5. Document env vars in `.env.example` if new secrets appear.
6. Add tests for money, auth revocation, or win-rate style logic.
7. Note product impact in PR (especially plan gating, emails, webhooks).

### 2.5 Background Workers

`DextopusDepositSyncService.start()` runs inside the web process on boot. Changes to deposit sync affect production continuously — treat like production-critical code (idempotency, retries, status transitions).

`initializeAccountDeletionCron()` (`ACCOUNT_DELETION_PURGE_CRON`, default `20 3 * * *`) runs the irreversible account purge. This is the **only** job in the codebase that destroys member data, so it gets the same scrutiny as payments:

- Every step is idempotent and the account is claimed atomically (`deletionPurgeStartedAt`), so a mid-cascade restart is retried, not lost, and a racing revocation cannot half-delete an account.
- The `User` document is removed **last**. Never reorder this — an interrupted purge must leave an account that still logs in, never a live account whose data has silently vanished.
- `ACCOUNT_DELETION_PURGE_ENABLED=false` pauses the purge only (requests and revocations still work). Leaving it off breaks store compliance — we would be scheduling deletions we never carry out.
- Never test against production credentials. To exercise it locally, set `ACCOUNT_DELETION_PURGE_CRON="* * * * *"` and backdate `deletionScheduledFor` on a throwaway user.

### 2.6 Ops Scripts

| Script | Use |
|--------|-----|
| `src/scripts/sendBetaWelcomeBlast.ts` | Controlled welcome email blasts (`--send`, `--force`, `--limit`) |
| `src/scripts/purgeMalformedUsers.ts` | Cleanup unverified malformed emails |

Run scripts deliberately with production credentials only after peer acknowledgment. Prefer dry-run defaults when available.

---

## 3. Git Process

### 3.1 Branch Naming

Suggested prefixes:

| Prefix | Use |
|--------|-----|
| `feat/` | New capability |
| `fix/` | Bug fix |
| `chore/` | Tooling, deps, non-feature |
| `refactor/` | Restructure without behavior change |
| `docs/` | Documentation only |
| `hotfix/` | Urgent production fix branched from release/main |

Examples: `feat/journal-ai-ask`, `fix/paystack-idempotency`, `hotfix/deposit-sync-stuck`.

### 3.2 Commits

- Prefer focused commits; avoid mixing unrelated refactors with fixes.
- Message style: imperative, concise, explain **why** when non-obvious.
- Examples:
  - `fix: blacklist JWT on logout before cookie clear`
  - `feat: credit SIGcoin on first subscribed referral`
  - `chore: document FCSAPI monthly usage cap`

Do **not** commit: `.env`, keys, dumps, `node_modules`, local Mongo data.

### 3.3 Pull Requests

Every change destined for `main` goes through a PR:

1. Rebase or merge latest `main` before review.
2. Fill summary: what / why / risk.
3. List test plan (commands + manual checks).
4. Flag: payments, auth, webhooks, email fan-out, schema migrations.
5. Request review from at least one other engineer (CTO for high-risk).

### 3.4 Merge Policy

| Change type | Merge rule |
|-------------|------------|
| Docs / low risk | 1 approval |
| Feature | 1 approval + green tests |
| Auth / payments / referrals money | 1 approval + explicit test evidence + CTO optional |
| Hotfix | Expedited review; follow with post-mortem note if user-impacting |

Prefer **squash merge** or tidy linear history so `main` remains readable. Avoid force-push to `main`.

### 3.5 What Not to Do

- No `--no-verify` unless CTO-approved emergency (repo hooks if/when added).
- No committing secrets “temporarily.”
- No direct push to `main` except documented break-glass with follow-up PR.

---

## 4. Version Control

### 4.1 Source of Truth

- **Git** is the only source of truth for application code.
- **Render** deploys from the connected Git branch (typically `main`).
- **MongoDB** holds runtime data — not versioned in Git. Schema changes are additive where possible.

### 4.2 Versioning Scheme

Package version in `package.json` is currently `1.0.0`. Operational recommendation:

| Release type | Semver bump | Example |
|--------------|-------------|---------|
| Breaking API contract | MAJOR | 2.0.0 |
| Backward-compatible feature | MINOR | 1.1.0 |
| Bugfix / patch | PATCH | 1.0.1 |

Tag releases after production promote:

```bash
git tag -a v1.1.0 -m "Pro deposit sync hardening"
git push origin v1.1.0
```

### 4.3 Artifact Versioning

| Artifact | Versioned how |
|----------|---------------|
| TypeScript source | Git commits / tags |
| Compiled `dist/` | Built on deploy; do not rely on committing `dist` |
| Env schema | `.env.example` in Git; values in Render env |
| Plan/referral economics | Code constants (`plans.ts`, `referral.ts`) — change via PR |

### 4.4 Dependencies

- Prefer `pnpm` for install consistency with Render.
- Lockfiles (`pnpm-lock.yaml`) must be committed when deps change.
- Review major upgrades (Mongoose, Express, JWT, payment SDKs) in isolation PRs.

---

## 5. Code Review Process

### 5.1 Author Checklist

Before requesting review:

- [ ] `pnpm build` succeeds
- [ ] `pnpm test` passes (or explain env blockers)
- [ ] No secrets in diff
- [ ] New env vars documented in `.env.example`
- [ ] Error paths return consistent `{ success: false, message }` via `AppError` / handler
- [ ] Auth correctly applied (public vs JWT vs secret header vs admin)
- [ ] Idempotency considered for webhooks / deposits / alerts
- [ ] Indexes considered for new query patterns

### 5.2 Reviewer Checklist

| Area | Look for |
|------|----------|
| Correctness | Edge cases: null user, expired OTP, duplicate play, race on payment |
| Security | Secret comparison, CORS, admin allowlist, raw webhook body |
| Data | Wrong `userId` scoping; leaked PII in logs |
| Reliability | External API timeouts; cache TTLs; poller loops |
| Clarity | Names match domain; avoid silent swallow of errors |
| Tests | Regression coverage for bugfixes |

### 5.3 Review Timing & Tone

- Target first review within **one business day**.
- Prefer concrete suggestions over vague “nit.”
- Blocking comments = correctness/security; non-blocking = style.
- Authors respond to all blocking items before merge.

### 5.4 High-Risk Review Paths

Require heightened attention when files touch:

- `auth.service.ts`, `auth.middleware.ts`, token blacklist
- `paystack.service.ts`, webhook routes, `subscription.service.ts`
- `dextopus*.ts`, deposit models
- `signals.controller.ts` alert fan-out
- `referral.service.ts`, SIGcoin ledger
- Env validation in `config/env.ts`

---

## 6. Testing

### 6.1 How Tests Run

```bash
pnpm test
```

This:

1. Compiles with `tsc`
2. Runs Node’s built-in test runner against `dist/tests/*.test.js`
3. Injects minimal env: `MONGO_URI`, `JWT_SECRET`, `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY`

### 6.2 Current Test Suites

| File | Focus |
|------|-------|
| `src/tests/authRevocation.test.ts` | Logout / blacklist behavior |
| `src/tests/googleAuth.test.ts` | Google audience / fail-closed behavior |
| `src/tests/payments.test.ts` | Payment / subscription application paths |
| `src/tests/signalWinRate.test.ts` | Win-rate aggregation correctness |

### 6.3 Testing Expectations by Change

| Change | Minimum bar |
|--------|-------------|
| Pure docs | Build not required for merge; courtesy build OK |
| New service helper | Unit test when logic is non-trivial |
| Auth / Google / OTP | Extend auth suites |
| Payments / deposits | Extend payments tests; manual sandbox checkout |
| Win-rate / plays | Extend signalWinRate |
| Email templates | Manual HTML preview + one staging send |

### 6.4 Manual / Integration Checks

Use staging (or local with test keys):

1. OTP send + verify (+ rate limit sanity)
2. Google login with real client id
3. Paystack test-mode upgrade + webhook
4. Deposit create + simulate status (or wait on Dextopus sandbox)
5. Signal play → history → journal import
6. Alert webhook with secret (idempotent second call)
7. Admin allowlist positive/negative

### 6.5 What We Do Not Have Yet (Gaps)

- No CI workflow in-repo (`.github/workflows`) at time of writing — run tests locally / on host before merge.
- No Docker-based test harness.
- Rate limiting is in-memory (not multi-instance safe) — load tests should account for that.

---

## 7. QA

### 7.1 QA Scope

QA validates **member journeys** against staging/production-like env, not only unit tests.

### 7.2 Core Regression Pack

| ID | Journey | Pass criteria |
|----|---------|---------------|
| QA-01 | Email OTP login | OTP arrives; JWT issued; `/auth/check` OK |
| QA-02 | Google login | Success when client id configured; 503 when misconfigured |
| QA-03 | Logout | Token rejected after logout |
| QA-04 | Approved signals | Authenticated list loads; public teaser stripped |
| QA-05 | Play signal | History shows play; win-rate updates |
| QA-06 | Journal CRUD | Default exists; row add/edit; import plays |
| QA-07 | Journal AI | Ask / AI column works with Anthropic key |
| QA-08 | Paystack upgrade | Pending → success; `plan=pro`; expiry set |
| QA-09 | Deposit upgrade | Address issued; success credits Pro |
| QA-10 | Referral | Code attached; SIGcoin on first paid sub only once |
| QA-11 | Notifications prefs | Opt-out stops matching emails |
| QA-12 | Alert webhook | Valid secret sends; invalid secret 401; duplicate no double-send |
| QA-13 | Chart presets | Save/load layout round-trip |
| QA-14 | Admin | Allowlisted email can access; others 403 |
| QA-15 | Account deletion | Request sets a date 30 days out; `/auth/check` **and** login both return `pendingDeletion`; revoke clears it; purge deletes personal data, anonymises money rows, and 401s the old token |
| QA-15 | Health | `/health` returns ok |

### 7.3 Severity Definitions

| Severity | Meaning | Example |
|----------|---------|---------|
| **S1** | Outage / data loss / money wrong | Webhook double-grants Pro; auth open |
| **S2** | Major feature broken | Signals feed empty for all Pro users |
| **S3** | Partial / workaround exists | AI column fails; journal still works |
| **S4** | Cosmetic / minor | Email template spacing |

### 7.4 QA Sign-Off

For releases touching payments/auth:

1. Run QA-01–QA-15 (or subset mapped to change)
2. Record results (pass/fail + env + build SHA)
3. S1/S2 must be resolved or explicitly waived by CTO before promote

---

## 8. Bug Reporting

### 8.1 Report Template

```markdown
### Title
[Area] Short symptom

### Environment
- Env: local / staging / production
- Build / commit: <sha>
- User id / email (if safe): 
- Time (UTC): 

### Severity
S1 / S2 / S3 / S4

### Steps to Reproduce
1.
2.
3.

### Expected
…

### Actual
…

### Evidence
- Screenshots / response JSON / logs
- Request id / Paystack reference / deposit id

### Suspected Area
auth | signals | payments | journal | referrals | email | charts | other
```

### 8.2 Triage

| Step | Owner |
|------|-------|
| Confirm severity | On-call / CTO |
| Reproduce | Engineer assignee |
| Root cause | Assignee |
| Fix PR | Assignee |
| Verify | QA or second engineer |
| Close | Only after verify on target env |

### 8.3 Logging Guidance for Diagnosis

Useful server signals:

- Morgan request logs
- `[signal-alert]` send/fail lines
- Deposit sync status transitions
- `AppError` messages returned to clients (avoid leaking internals)

Never paste live `JWT_SECRET`, Paystack live keys, or full card data into tickets.

---

## 9. Release Cycle

### 9.1 Cadence (Recommended)

| Cadence | Content |
|---------|---------|
| **Continuous** | Merge reviewed PRs to `main` when green |
| **Weekly** | Cut tagged release when features accumulate |
| **Hotfix** | As needed for S1/S2 |

### 9.2 Release Steps

1. Freeze scope (list PRs / commits since last tag).
2. Ensure `main` builds and tests pass.
3. Run regression pack on staging.
4. Tag version (`vX.Y.Z`).
5. Deploy / confirm Render deploy of commit SHA.
6. Smoke: `/health`, login, signals, one payment path if billing changed.
7. Announce in engineering channel: version, SHA, notable changes, known issues.
8. Monitor 30–60 minutes post-release (errors, deposit poller, email).

### 9.3 Changelog Discipline

Maintain a short `docs/CHANGELOG.md` or GitHub Releases notes:

- Added / Changed / Fixed / Security
- Call out paused features (e.g. SL alert emails)
- Call out env var additions

### 9.4 Feature Flags

No dedicated feature-flag service exists today. Patterns in use:

- Env-gated optional APIs (missing keys disable features)
- Code pauses (e.g. SL email `status: "paused"`)
- Frontend plan gating

For risky launches, prefer env toggles or admin-server side controls over blind deploys.

---

## 10. Deployment

### 10.1 Platform

Render Blueprint (`render.yaml`):

| Field | Value |
|-------|-------|
| Service name | `signova-server` |
| Env | Node |
| Build | `corepack enable && pnpm install --frozen-lockfile && pnpm build` |
| Start | `pnpm start` |
| `NODE_ENV` | `production` |

### 10.2 Deploy Flow

```
Push / merge to connected branch (main)
        │
        ▼
Render build (pnpm install + tsc)
        │
        ▼
Start node dist/index.js
        │
        ▼
connectDB → mount routes → DextopusDepositSyncService.start()
        │
        ▼
Verify /health
```

### 10.3 Pre-Deploy Checklist

- [ ] Required env vars present on Render (see section 12)
- [ ] `FRONTEND_URL` / `FRONTEND_URLS` include production origins
- [ ] Paystack webhook URL points at `https://<api>/payments/webhook`
- [ ] Shared secrets match admin server (`SIGNALS_*`)
- [ ] Mongo IP allowlist / Atlas network access OK
- [ ] Migrations / index needs noted (vector index for predictions if used)

### 10.4 Post-Deploy Smoke

```bash
curl -s https://<host>/health
curl -s https://<host>/
```

Then: one OTP login (or test OTP on staging), fetch public signals teaser, confirm no error spike.

### 10.5 CI Gap

There is **no** in-repo GitHub Actions pipeline yet. Until added:

- Treat `pnpm build && pnpm test` as mandatory pre-merge.
- Consider adding a workflow: install → build → test on PR.

---

## 11. Rollback Procedure

### 11.1 When to Rollback

Trigger rollback if after deploy:

- `/health` fails or service crash-loops
- Auth broken for majority of users (S1)
- Incorrect money grants or double charges (S1)
- Signals unusable for Pro members (S2) with no quick forward fix

Prefer **forward fix** when the issue is tiny and a patch can ship in minutes.

### 11.2 Application Rollback (Render)

1. Identify last known good deploy (commit SHA / Render deploy id).
2. In Render dashboard: **Rollback** to previous successful deploy  
   **or** re-deploy previous Git SHA / revert PR and push.
3. Confirm `/health` and critical journeys.
4. Notify engineering + support: “rolled back to `<sha>` because …”
5. File incident ticket; keep broken `main` from remaining shipped — revert commit on `main` if rollback was host-only.

### 11.3 Data / Payment Caveats

Rolling back **code** does not undo:

- Pro activations already written to Mongo
- Ledger / SIGcoin grants
- Sent emails
- Paystack charges

If a bad deploy corruptedly granted entitlements:

1. Stop the bad code path (rollback).
2. Query affected `Transaction` / `Deposit` / `User` records.
3. Correct with a controlled script or admin action (peer-reviewed).
4. Document remediation in the incident write-up.

### 11.4 Schema Rollback

Avoid destructive schema changes. If a deploy requires new fields, keep them optional. Rolling back code onto a DB that already has new data should remain safe (forward-compatible reads).

If an index build fails mid-way, fix forward — do not drop production data to “undo.”

### 11.5 Post-Rollback

- Hotfix branch from known good tag
- Postmortem for S1 (timeline, impact, root cause, action items)
- Add regression test when applicable

---

## 12. Environments & Secrets

### 12.1 Environments

| Env | Purpose |
|-----|---------|
| Local | Developer machines |
| Staging (recommended) | QA + payment sandboxes |
| Production | Render `signova-server` |

### 12.2 Required Secrets

| Variable | Why |
|----------|-----|
| `MONGO_URI` | Database |
| `JWT_SECRET` | Session signing |
| `PAYSTACK_SECRET_KEY` | Payments + webhook HMAC |

### 12.3 Strongly Recommended

| Variable | Why |
|----------|-----|
| `GOOGLE_CLIENT_ID` | Google login (fails closed if missing) |
| `FRONTEND_URL` / `FRONTEND_URLS` | CORS + callbacks |
| `ADMIN_SERVER_URL` | Signal source |
| `SIGNALS_READ_SECRET` | Outbound admin reads |
| `SIGNALS_ALERT_SECRET` | Inbound alerts |
| `SIGNALS_INVALIDATE_SECRET` | Cache bust |
| `RESEND_API_KEY` | Email |
| `ADMIN_EMAILS` | Affiliate admin |

### 12.4 Optional Feature Keys

`FCSAPI_KEY`, `FINNHUB_API_KEY`, `ALPHAVANTAGE_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, Dextopus-* settings.

`ACCOUNT_DELETION_GRACE_DAYS` (default 30), `ACCOUNT_DELETION_PURGE_CRON` (default `20 3 * * *`), `ACCOUNT_DELETION_PURGE_ENABLED` (defaults **on** when unset) — see §2.5.

### 12.5 Test OTP

`TEST_OTP_EMAIL` / `TEST_OTP_CODE` / `ENABLE_TEST_OTP` — **never** enable broadly on public production. Staging only with known addresses.

---

## 13. On-Call / Incident Basics

### 13.1 First Five Minutes

1. Check `/health` and Render logs.
2. Check Mongo / Atlas status.
3. Check admin server reachability if signals empty.
4. Check Paystack / Dextopus status pages if payments failing.
5. Decide: rollback vs forward fix vs vendor outage communication.

### 13.2 Communication

- Internal: severity, impact, ETA
- Support: user-facing status if login/payments broken
- Avoid speculative root causes in public channels

### 13.3 Recurring Risks to Watch

| Risk | Mitigation |
|------|------------|
| In-memory rate limits multi-instance | Sticky routing or Redis later |
| Deposit poller inside web dyno | Sleep/restart can delay credits — monitor |
| FCSAPI monthly cap | `/signals/usage` + alerts |
| Email provider rate limits | Batched sends already; watch Resend |

---

## 14. Appendix — Commands Cheat Sheet

```bash
# Install
corepack enable && pnpm install

# Develop
pnpm dev

# Build
pnpm build

# Start compiled
pnpm start

# Test
pnpm test

# Type watch
pnpm watch
```

**Health**

```bash
curl -s localhost:3001/health
```

**Related docs**

- [Product Manual](./01-product-manual.md)
- [Technical Growth Manual](./03-technical-growth-manual.md)

---

*End of Engineering Operations Manual.*
