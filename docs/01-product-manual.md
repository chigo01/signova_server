# Signova Product Manual

**Audience:** Product, design, support, and leadership  
**Scope:** End-user product behavior as implemented by the Signova API (`fx-signals-server`) and its integration surface with the admin server and frontend apps  
**Version:** 1.0 — aligned with codebase as of July 2026  
**Owner:** CTO / Product Operations

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [App Architecture](#2-app-architecture)
3. [User Flow](#3-user-flow)
4. [Navigation Model](#4-navigation-model)
5. [Feature Explanations](#5-feature-explanations)
6. [Notification Flow](#6-notification-flow)
7. [Subscription Flow](#7-subscription-flow)
8. [Journal Integration](#8-journal-integration)
9. [Dashboard](#9-dashboard)
10. [Signal Interface](#10-signal-interface)
11. [Referrals & Affiliate Surface](#11-referrals--affiliate-surface)
12. [Roles & Access](#12-roles--access)
13. [Glossary](#13-glossary)
14. [Appendix — API Surface Map](#14-appendix--api-surface-map)

---

## 1. Introduction

### 1.1 What Signova Is

Signova is an FX (forex) signals platform. Traders receive curated **elite / approved** trading signals, track personal performance, journal trades, view market context (charts, stocks, news, education), and optionally subscribe to Pro for full access.

This repository is the **member-facing API** — the backend the web/mobile clients talk to. Trading signal *creation* and approval happen on a separate **admin server**; this API reads those signals, fans out alerts, manages users, payments, journals, and market data proxies.

### 1.2 Product Goals

| Goal | How the product supports it |
|------|-----------------------------|
| Deliver timely FX signals | Approved-signal feed + email alerts (new signal, TP hits, adjustments) |
| Help traders learn from outcomes | Signal play history, win-rate stats, journal import |
| Monetize premium access | Pro plan via Paystack (card) or Dextopus (stablecoin) |
| Grow via affiliates | Referral codes, SIGcoin rewards, admin payout tooling |
| Keep charts personal | TradingView layouts, study/drawing/chart templates |

### 1.3 System Actors

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  End User   │────▶│  Signova Server  │◀────│  Admin Server   │
│  (Frontend) │     │  (this repo)     │     │  (signals ops)  │
└─────────────┘     └────────┬─────────┘     └─────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         MongoDB        Paystack /      FCSAPI / Finnhub /
                        Dextopus        Alpha Vantage / OpenAI /
                        Resend          Anthropic Claude
```

| Actor | Responsibility |
|-------|----------------|
| **End user** | Signs in, views signals, plays trades, journals, pays, refers friends |
| **Frontend app** | UX, plan gating UI, TradingView charts, settings |
| **Signova server** | Auth, subscriptions, journals, alerts fan-out, market proxies |
| **Admin server** | Creates/approves signals; pushes alert webhooks; serves elite signal list |
| **Affiliate admin** | Admin-email allowlist users managing rates and payouts |

### 1.4 Plans at a Glance

| Plan | Identity in API | Duration | Display price (USD) |
|------|-----------------|----------|---------------------|
| Free | `plan: "free"` | — | — |
| Pro (1 month) | `planId: "pro"` | 30 days | $100 |
| Business (2 months) | `planId: "business"` | 60 days | $200 |

Internally, successful payment always results in `plan: "pro"` with `proPlanExpiry` extended. “Business” is a 2-month checkout SKU, not a separate entitlement tier.

> **Product note:** Plan enforcement for signal access is expected primarily on the **frontend**. The API tracks `plan` / `proPlanExpiry` and returns them on auth check; members should treat expiry as the source of truth for Pro status.

---

## 2. App Architecture

### 2.1 Logical Layers

Signova follows a classic layered API architecture:

```
Client (Web / Mobile)
        │
        ▼
┌───────────────────────────┐
│  HTTP Edge                │  CORS · Helmet · Morgan · Cookies
│  Routes                   │  /auth /signals /journal /payments …
│  Middleware               │  JWT · Admin · Rate limit · Errors
│  Controllers              │  Validate input, shape HTTP
│  Services                 │  Business rules + external APIs
│  Models (Mongoose)        │  MongoDB persistence
└───────────────────────────┘
```

| Layer | Location | Role |
|-------|----------|------|
| Bootstrap | `src/index.ts` | Wires middleware, mounts routes, starts deposit sync |
| Routes | `src/routes/` | URL → controller mapping |
| Controllers | `src/controllers/` | Request/response adaptation |
| Services | `src/services/` | Domain logic |
| Models | `src/models/` | Schemas and indexes |
| Config | `src/config/` | Env, plans, referral economics, DB |
| Email | `src/services/email/` | Resend + HTML templates |

### 2.2 Runtime Topology

| Service | Purpose |
|---------|---------|
| **Signova API** | Member API (Render web service `signova-server`) |
| **MongoDB** | Source of truth for users, journals, plays, payments, caches |
| **Admin server** | Elite/approved signals + alert publisher |
| **Paystack** | Card / local payments (NGN checkout) |
| **Dextopus** | On-chain stablecoin deposits for funding & upgrades |
| **Resend** | Transactional email (OTP, welcome, signal alerts) |
| **FCSAPI** | Forex candles / latest for signals & charts |
| **Finnhub / Alpha Vantage** | Equities quotes, technicals, news |
| **OpenAI** | Stock recommendation narrative |
| **Anthropic Claude** | Journal AI ask + AI columns |

### 2.3 Data Ownership

| Data | Owner | Notes |
|------|-------|-------|
| Live signal definitions | Admin server | Cached briefly on Signova (`SignalsCache`, ~5 min) |
| Users, plans, prefs | Signova | Mongo `User` |
| Signal plays | Signova | Local `SignalPlay` when user “plays” a signal |
| Journals | Signova | Notion-like schema per user |
| Payments | Signova + providers | `Transaction` (Paystack), `Deposit` (Dextopus) |
| Chart presets | Signova | TradingView external save adapters |
| YouTube education links | Signova | `YoutubeLink` collection |

### 2.4 Security Boundaries (Product View)

- **Member JWT** (cookie `auth_token` or `Authorization: Bearer`) — 7-day session
- **Admin emails** — same login; gated by `ADMIN_EMAILS` for `/admin/*`
- **Service secrets** — admin → Signova for alerts & cache invalidation; Signova → admin for signal reads
- **Paystack HMAC** — webhook authenticity
- **OTP rate limits** — abuse protection on send/verify

---

## 3. User Flow

### 3.1 First-Time Signup (Email OTP)

```
Enter email (+ optional name, phone, referral code)
        │
        ▼
POST /auth/send-otp  ──▶  User created or found
        │                 OTP stored (10 min TTL)
        │                 Email via Resend (or logged in dev)
        ▼
Enter OTP
        │
        ▼
POST /auth/verify-otp ──▶ JWT issued
                          Welcome email (first verify)
                          Referral code ensured
                          Session cookie / token returned
        │
        ▼
Land on Dashboard / onboarding
```

**Referral attach rules (product):**

- Optional `referralCode` on send-OTP creates or links `referredBy` on first account creation.
- Referrer is rewarded only when that user **first becomes a paying subscriber** (1 SIGcoin), not on signup alone.

### 3.2 Returning Login

Same OTP flow, or **Sign in with Google**:

```
Frontend obtains Google access token
        │
        ▼
POST /auth/google ──▶ Token audience checked vs GOOGLE_CLIENT_ID
                      Find/create user by email, link googleId
                      JWT issued
```

If `GOOGLE_CLIENT_ID` is unset, Google login **fails closed** (service unavailable).

### 3.3 Session Continuity

| Action | Endpoint | Outcome |
|--------|----------|---------|
| App boot | `GET /auth/check` | Current user, plan, prefs, balances |
| Profile edit | `PATCH /auth/profile` | Name, username, role, phone, avatar, prefs, trade reversal |
| Logout | `POST /auth/logout` | JWT blacklisted until natural expiry |
| Delete account | `POST /auth/account/delete` | Schedules deletion 30 days out; nothing removed yet |
| Undo deletion | `POST /auth/account/delete/revoke` | Cancels a pending deletion |

### 3.4 Core Daily Loop (Active Trader)

```
Open Dashboard
  → Check approved signals
  → Open signal detail / chart context
  → "Play" signal (records SignalPlay)
  → Optional: import plays into Journal
  → Receive email if TP / adjustment fires
  → Review win rate / history
```

### 3.5 Upgrade Funnel

```
Pricing / Settings
  → Choose Pro or Business SKU
  → Pay with Paystack OR generate Dextopus deposit address
  → On success: plan=pro, expiry extended
  → Referrer credited (if first paid sub)
  → Full Pro UX unlocked (client-side gating)
```

### 3.6 Logout & Revocation

Logout adds the current token to `TokenBlacklist`. Subsequent requests with that token fail even before cookie expiry. New login issues a fresh JWT.

### 3.7 Account Deletion

Required by Google Play's account-deletion policy and App Store Review Guideline 5.1.1(v): members must be able to start deletion from inside the product, and from the web.

```
Settings → Delete account (type DELETE to confirm)
        │
        ▼
POST /auth/account/delete ──▶ deletionRequestedAt / deletionScheduledFor set
        │                     Confirmation email (states the exact date)
        │                     Nothing is deleted
        ▼
30-day grace window ── account works exactly as before
        │             every auth payload carries `user.pendingDeletion`
        │             webapp shows a banner on every dashboard route
        │
        ├── POST /auth/account/delete/revoke ──▶ cancelled, nothing lost
        │
        ▼
Purge cron (daily) ──▶ final email, Apple grant revoked,
                       personal data destroyed, money rows anonymised,
                       User document deleted → all sessions 401
```

**Product rules**

- The account stays **fully usable** during the grace window — no suspension, no muted alerts. Revoking is meant to be frictionless.
- Re-requesting deletion is idempotent: the original date stands, so a member cannot keep an account alive by re-requesting.
- Remaining Pro time is forfeited and not refunded. Deletion is never gated on billing state — neither store permits that.
- Signing up again after the purge creates a brand new account; nothing is restored.

**What the purge destroys vs retains**

| Treatment | Data |
|-----------|------|
| Deleted outright | User profile, journals, signal plays, chart layouts/templates/study/drawing templates, watchlists, push installations, stock-news deliveries |
| Retained, identity stripped | Transactions, deposits, SIGcoin ledger, referral earnings, affiliate payouts — user refs are repointed at a synthetic id so accounting still reconciles |
| Audit record | `AccountDeletion` row: hashed email, dates, per-collection counts. No PII. |

Referrers keep SIGcoins already earned; `referredBy` is cleared on any user the deleted account referred.

---

## 4. Navigation Model

This section describes the **information architecture** the API implies for the frontend. Exact UI labels may vary; route prefixes are the product’s capability map.

### 4.1 Primary Areas

| Area | Backend prefix | Member intent |
|------|----------------|---------------|
| **Auth / Account** | `/auth` | Login, profile, notification prefs |
| **Dashboard home** | composed | Overview of signals + performance + market teasers |
| **Signals** | `/signals` | Approved feed, play, history, win rate |
| **Charts / Analysis** | `/tv`, `/analysis`, `/chart-presets` | TradingView datafeed + pair overlays + saved layouts |
| **Journal** | `/journal` | Trade log with custom properties + AI |
| **Stocks** | `/stocks` | Equity recommendations & news (public teaser) |
| **Education** | `/youtube` | Curated video links |
| **Billing** | `/payments` | Upgrade, balance, deposits, transaction status |
| **Referrals** | `/referrals` | Share code, earnings overview, leaderboard |
| **Admin (affiliate ops)** | `/admin` | Users, rates, payouts (allowlisted emails) |

### 4.2 Suggested Screen Map (Frontend)

```
App Shell
├── Login / OTP / Google
├── Dashboard
│   ├── Signals snapshot
│   ├── Win-rate / recent plays
│   ├── Stocks / news widgets
│   └── Education spotlight
├── Signals
│   ├── Feed (approved)
│   ├── Detail + chart
│   └── History
├── Charts
│   ├── Symbol chart (TV)
│   └── Saved layouts / templates
├── Journal
│   ├── Default journal
│   ├── Custom views (table / calendar / board / …)
│   └── Ask AI
├── Settings
│   ├── Profile
│   ├── Notifications
│   ├── Pricing / upgrade
│   └── Wallet / deposits
└── Referrals
    ├── Overview
    ├── Transactions
    └── Leaderboard
```

### 4.3 Public vs Authenticated Navigation

| Capability | Auth required |
|------------|---------------|
| Approved signals (full) | Yes |
| Approved signals teaser (stripped fields) | No — `/signals/approved/public` |
| Stocks recommendations / news | No |
| YouTube links | No |
| TradingView UDF endpoints | No |
| Pair analysis | No |
| Journal, plays, payments, referrals, presets | Yes |

---

## 5. Feature Explanations

### 5.1 Authentication & Profile

**What it does:** Passwordless email OTP and Google sign-in; persistent member profile.

**Key fields on user (product-relevant):**

- Identity: `email`, `name`, `username`, `phone`, `avatarDataUrl`, `role`
- Trading: `tradeReversalEnabled` (default true)
- Notifications: `newSignals`, `tradeAlerts`, `newsletter`
- Entitlement: `plan`, `proPlanExpiry`
- Wallet: `balanceUsdMicro` (Dextopus funding)
- Affiliate: `referralCode`, `sigcoins`, `sigcoinRateUsd`

**Roles (profile):** Fixed list of trading-role strings for personalization (not RBAC). Admin access is separate (email allowlist).

### 5.2 Trading Signals

**What it does:** Surfaces elite/approved signals from the admin server, caches them briefly, lets users record a “play,” and exposes history + win-rate aggregations.

**Play:** When a member commits to a signal, the API stores a `SignalPlay` with symbol, direction (`buy`/`sell`), entry, optional TP/SL, and timestamp. Plays feed journal import and performance stats.

**Public teaser:** Unauthenticated endpoint returns a reduced field set (`_id`, `pair`, `direction`, `entryPrice`, `takeProfit1`) for marketing / landing pages.

**Pair history / FCSAPI:** Authenticated routes under `/signals` also expose FCSAPI-backed pair signal history and monthly API usage for ops visibility.

### 5.3 Charts & Analysis

**TradingView datafeed (`/tv/*`):** Config, search, symbols, history, time, quotes — standard UDF-style surface so the chart widget can render FX data.

**Analysis (`/analysis/pairs/:symbol`):** Overlay / analytical presets for a pair (resolution and date range optional).

**Chart presets (`/chart-presets`):** Personal storage for layouts, study templates (with default), drawing templates, and chart templates — so a user’s chart workspace persists across devices.

### 5.4 Stocks & News

Public market widgets:

- **Recommendations** — watchlist quotes/technicals scored toward BUY / HOLD / SELL (OpenAI narrative when configured; deterministic fallback otherwise)
- **News** — market news aggregation via Finnhub/news services

These are complementary context, not the core FX signal product.

### 5.5 Education (YouTube)

CMS-like list of active YouTube links (`title`, `url`, `videoId`, `order`) for in-app learning modules.

### 5.6 Referrals

Members get an 8-character uppercase code. Sharing drives signup attribution. Economics:

- **1 SIGcoin** when a referred user first becomes a paying subscriber
- Payout value = `sigcoins × sigcoinRateUsd` (admin-set $2–$5 per coin; default $2)

### 5.7 Affiliate Admin

Allowlisted admins can:

- View platform stats and leaderboard
- List/inspect users
- Set per-user SIGcoin rates
- Record payouts against affiliates

---

## 6. Notification Flow

### 6.1 Channels

| Channel | Mechanism | Used for |
|---------|-----------|----------|
| Email (Resend) | Transactional HTML templates | OTP, welcome, signal lifecycle alerts |
| In-app prefs | User `notificationPreferences` | Opt-out of new-signal vs trade-alert emails |

Push notifications (device tokens) are **not** implemented server-side in this repo; product email is the primary alert rail.

### 6.2 Preference Mapping

| Alert type | Preference key |
|------------|----------------|
| `NEW_SIGNAL` | `newSignals` |
| `TP1`, `TP2`, `SIGNAL_ADJUSTED` (and trade lifecycle) | `tradeAlerts` |
| Newsletter | `newsletter` (profile flag; campaign sends are separate ops) |

Users opt out by setting the corresponding preference to `false` via `PATCH /auth/profile`.

### 6.3 Signal Alert Pipeline

```
Admin server detects event
        │
        ▼
POST /signals/alert
  Header: x-alert-secret = SIGNALS_ALERT_SECRET
  Body: signalId, alertType, pair, prices, reasoning, …
        │
        ▼
Validate alertType ∈ {
  NEW_SIGNAL, TP1, TP2, SL, SL_WARNING, SIGNAL_ADJUSTED
}
        │
        ├─ SL / SL_WARNING ──▶ Currently PAUSED (200 { status: "paused" })
        │                         No email fan-out
        │
        ▼
Idempotency: insert SignalAlertNotification(signalId, alertType)
  (duplicate → no second blast)
        │
        ▼
Query users with matching preference ≠ false
        │
        ▼
Batch send via Resend templates:
  newSignal · tp1Hit · tp2Hit · signalAdjusted
  (slHit / slApproaching templates exist but path is paused)
        │
        ▼
Log sent / failed counts
```

### 6.4 Alert Types (Product Meaning)

| Type | Member experience |
|------|-------------------|
| `NEW_SIGNAL` | “New elite setup available” email |
| `TP1` | First take-profit hit |
| `TP2` | Second take-profit hit |
| `SIGNAL_ADJUSTED` | Parameters changed mid-trade (idempotency key may include adjustment fingerprint) |
| `SL` / `SL_WARNING` | Stop loss / approaching — **not emailed currently** (paused) |

### 6.5 Cache Invalidation (Ops Signal)

Admin may call `POST /signals/cache/invalidate` with `x-invalidate-secret` so members see fresh approved lists immediately after publish — product latency benefit, not a user-facing notification.

### 6.6 Lifecycle Emails Outside Alerts

| Event | Template |
|-------|----------|
| First successful OTP / identity | Welcome email; `welcomedAt` set |
| OTP issuance | OTP email (or console log in development) |
| Ops beta blasts | Script: `sendBetaWelcomeBlast.ts` |

---

## 7. Subscription Flow

### 7.1 Entitlement Model

```
User.plan            = "free" | "pro"
User.proPlanExpiry   = Date when Pro ends
```

Activation / extension adds **30 days × months** from the SKU (`pro` = 1 month, `business` = 2 months). Extensions stack from the later of *now* or current expiry (subscription service behavior).

### 7.2 Path A — Paystack (Card / Local)

```
Member selects planId: "pro" | "business"
        │
        ▼
POST /payments/upgrade
        │
        ▼
Create Transaction (pending)
Initialize Paystack → authorizationUrl
        │
        ▼
Member completes checkout on Paystack
        │
        ├─▶ Paystack webhook POST /payments/webhook (HMAC verified)
        │         applySuccessfulPayment (atomic)
        │
        └─▶ Client polls GET /payments/transactions/:id
                  (verify path if webhook delayed)
        │
        ▼
SubscriptionService.activateOrExtendPro
ReferralService.creditSubscribedReferral (once)
```

**Callback:** Defaults toward `${FRONTEND_URL}/dashboard/settings/pricing` unless `PAYSTACK_CALLBACK_URL` is set.

### 7.3 Path B — Dextopus (Stablecoin Deposit)

```
POST /payments/deposits
  type: plan_upgrade | account_funding
        │
        ▼
Create Deposit + Dextopus deposit address
        │
        ▼
Member sends on-chain funds
        │
        ▼
DextopusDepositSyncService (background poller)
  polls provider until success / fail / expiry
        │
        ├─ account_funding ──▶ credit balanceUsdMicro
        └─ plan_upgrade   ──▶ activate Pro + referral credit
```

Members can inspect `GET /payments/deposits/:id` and `GET /payments/balance`.

### 7.4 Pricing Config (Code Truth)

From `src/config/plans.ts`:

| planId | months | displayUsd | priceNgn (checkout) |
|--------|--------|------------|---------------------|
| `pro` | 1 | 100 | 100 |
| `business` | 2 | 200 | 200 |

> Ops should confirm NGN amounts match production Paystack pricing; repository values may reflect sandbox/test magnitudes.

### 7.5 Referral Side-Effect on Subscribe

On first successful paid subscription for a referred user:

1. Referrer earns **1 SIGcoin**
2. Ledger entry recorded (`SigcoinLedger`)
3. `subscribedReferralCredited` prevents double awarding

### 7.6 Failure & Edge Cases (Product Expectations)

| Case | Expected behavior |
|------|-------------------|
| Abandoned Paystack checkout | Transaction remains `pending` / expires; no Pro grant |
| Duplicate webhook | Idempotent apply — no double extension |
| Deposit expired | Deposit `expired`; member must create a new deposit |
| Already Pro, pays again | Expiry extends (stacking) |

---

## 8. Journal Integration

### 8.1 Concept

The journal is a **Notion-like trade log**: each journal has typed properties (columns), optional views, and rows of cells. Every user gets an auto-created **default journal**.

### 8.2 Default Columns

When a journal is created, default properties include:

| Property | Typical meaning |
|----------|-----------------|
| `pair` | Instrument (e.g. EURUSD) |
| `date` | Trade / entry date |
| `bias` | Directional bias |
| `point-of-interest` | Level / narrative POI |
| `outcome` | Result of the trade |

Members can add/hide properties and change types: `text`, `date`, `select`, `multi-select`, `number`, `ai`.

### 8.3 Views

Journals support multiple views with types: `table`, `calendar`, `board`, `gallery`, `list` — same underlying rows, different presentation.

### 8.4 Signal Play Import

```
User has SignalPlay history
        │
        ▼
POST /journal/:journalId/import-signal-plays
        │
        ▼
Rows created / linked with:
  linkedSignalPlayId
  sourceSignalId
  cells mapped into journal properties
```

This is the bridge between **live signal UX** and **reflective journaling**.

### 8.5 AI Features (Claude)

| Endpoint | Product value |
|----------|---------------|
| `POST /journal/:journalId/ask` | Natural-language Q&A over the journal contents |
| `POST /journal/:journalId/rows/:rowId/ai` | Fill AI-typed columns (summary, key-info, custom prompt, translation) |

AI requires `ANTHROPIC_API_KEY`. Without it, AI actions fail gracefully for ops (feature unavailable).

### 8.6 CRUD Surface

| Action | Method |
|--------|--------|
| List journals | `GET /journal/` |
| Create | `POST /journal/` |
| Get default | `GET /journal/default` |
| Get one | `GET /journal/:journalId` |
| Update meta/schema | `PATCH /journal/:journalId` |
| Delete | `DELETE /journal/:journalId` |
| Add row | `POST /journal/:journalId/rows` |
| Update row | `PATCH /journal/:journalId/rows/:rowId` |

Ownership is always scoped to the authenticated `userId`.

---

## 9. Dashboard

### 9.1 Purpose

The Dashboard is a **composed client view** — the API does not expose a single `/dashboard` resource. The frontend aggregates several endpoints into one first paint.

### 9.2 Recommended Data Composition

| Widget | Source | Auth |
|--------|--------|------|
| User / plan banner | `GET /auth/check` | JWT |
| Live signals | `GET /signals/approved` | JWT |
| Performance | `GET /signals/win-rate`, `GET /signals/history` | JWT |
| Stocks teaser | `GET /stocks/recommendations` | Public |
| News strip | `GET /stocks/news` | Public |
| Education | `GET /youtube/` | Public |
| Wallet (if shown) | `GET /payments/balance` | JWT |
| Referral CTA | `GET /referrals/overview` | JWT |

### 9.3 Product Principles for Dashboard UX

1. **One primary job:** Orient the trader on *what to trade next* and *how they’re performing*.
2. **Plan-aware:** Free users see upgrade CTAs driven by `plan` / `proPlanExpiry`.
3. **Freshness:** Signal cache is short (~5 minutes); invalidation webhook keeps launches snappy.
4. **Non-blocking widgets:** Stocks/news/youtube can fail independently without blanking the whole page.

### 9.4 Empty & Edge States

| State | Guidance |
|-------|----------|
| New user, no plays | Emphasize signals feed + “play” CTA; soft-empty history |
| Pro expired | Banner with expiry + pricing path |
| No approved signals | Calm empty state; education / youtube fallback |
| Alert emails off | Still show in-app feed; prefs live under profile |

---

## 10. Signal Interface

### 10.1 Feed

**Authenticated:** `GET /signals/approved`  
Full elite/approved payloads as provided by the admin server (plus caching layer).

**Public:** `GET /signals/approved/public`  
Marketing-safe subset of fields.

### 10.2 Play Action

```
POST /signals/play
Body: signal identity + execution snapshot (prices, direction, …)
        │
        ▼
Persist SignalPlay for user
        │
        ▼
Available in history / win-rate / journal import
```

“Play” is the product’s explicit commitment event — distinct from merely viewing a signal.

### 10.3 History & Win Rate

| Endpoint | Use |
|----------|-----|
| `GET /signals/history?page&limit` | Paginated personal play log |
| `GET /signals/win-rate` | Aggregate performance for dashboard / profile |

### 10.4 Pair Drill-Down

`GET /signals/pair/:pair/signals` — historical FCSAPI-backed context for a pair (authenticated). Useful for chart side-panels and education around a setup.

`GET /signals/usage` — monthly FCSAPI call consumption (ops / power-user transparency; soft cap ~500/month in service logic).

### 10.5 Cross-Service Consistency

```
Admin publishes / updates elite signal
        │
        ├─▶ Members poll /signals/approved (cached ≤ ~5 min)
        ├─▶ Admin may invalidate cache immediately
        └─▶ Admin may POST /signals/alert for email fan-out
```

Members should never create signals in this API — **consume only**.

### 10.6 Trade Reversal Preference

`tradeReversalEnabled` on the user profile is a client-consumed preference for how signal directions are presented/acted on. Persist via profile patch; meaning is product/UX layered on top of raw signal direction.

---

## 11. Referrals & Affiliate Surface

### 11.1 Member Flow

1. Verify account → referral code generated  
2. Share link/code (frontend uses `FRONTEND_URL` / share patterns)  
3. Friend signs up with code → `referredBy` set  
4. Friend pays for Pro → referrer +1 SIGcoin  
5. Member views `/referrals/overview`, transactions, leaderboard  

### 11.2 Admin Flow

1. Admin logs in via normal OTP (email ∈ `ADMIN_EMAILS`)  
2. Inspect users, set `sigcoinRateUsd` within $2–$5  
3. Record payouts (`AffiliatePayout`)  
4. Monitor leaderboard / stats  

---

## 12. Roles & Access

| Persona | Access mechanism | Capabilities |
|---------|------------------|--------------|
| Anonymous visitor | None | Public teasers, stocks, TV, youtube, analysis |
| Free member | JWT | Auth surfaces; signals play/history; journal; referrals; gated Pro UX on client |
| Pro member | JWT + `plan=pro` & valid expiry | Same API; full client entitlement |
| Affiliate admin | JWT + email allowlist | `/admin/*` |
| Admin server (machine) | Shared secrets | Alerts, cache invalidate; Signova reads with service secret |

---

## 13. Glossary

| Term | Meaning |
|------|---------|
| **Elite / approved signal** | Curated setup from admin server shown to members |
| **Play** | Member records taking a signal (`SignalPlay`) |
| **Pro** | Paid entitlement (`plan=pro` until `proPlanExpiry`) |
| **Business** | Two-month Paystack/Dextopus SKU |
| **SIGcoin** | Affiliate unit earned per first subscribed referral |
| **Journal** | Customizable trade log with optional AI columns |
| **Default journal** | Auto-created primary journal per user |
| **Alert** | Admin-originated lifecycle email event |
| **Dextopus** | Stablecoin deposit / swap provider |
| **FCSAPI** | Forex data provider for candles and pair history |

---

## 14. Appendix — API Surface Map

| Prefix | Product domain |
|--------|----------------|
| `/auth` | Identity & profile |
| `/signals` | Signals, plays, FCSAPI helpers, admin webhooks |
| `/journal` | Trade journaling + AI |
| `/payments` | Paystack + Dextopus + balance |
| `/chart-presets` | TradingView persistence |
| `/tv` | Chart datafeed |
| `/analysis` | Pair analysis |
| `/stocks` | Equity widgets |
| `/youtube` | Education |
| `/referrals` | Affiliate member views |
| `/admin` | Affiliate admin |
| `/health` | Liveness |

Health & root:

- `GET /` → welcome JSON  
- `GET /health` → `{ status: "ok", timestamp }`

---

*End of Product Manual. For engineering process, see [Engineering Operations Manual](./02-engineering-operations-manual.md). For architecture scale-out, see [Technical Growth Manual](./03-technical-growth-manual.md).*
