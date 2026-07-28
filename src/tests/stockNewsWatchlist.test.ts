import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStockNewsDeliveryHealth,
  isValidTimeZone,
  normalizeStockSymbol,
} from "../services/watchlist.service";
import {
  effectivePlan,
  isEffectivePro,
} from "../services/planEntitlement.service";
import {
  canonicalNewsFingerprint,
  dailyStockNewsDeliveryKey,
  eligibleMaterialArticles,
  localDateAndHour,
  shouldScheduleDailyDigest,
  stockNewsDeliveryIsRetryable,
} from "../services/stockNewsAlert.service";
import { stockNewsAvailability } from "../services/stockNewsReadiness.service";
import {
  stockNewsDigestEmail,
  stockNewsImmediateEmail,
} from "../services/email/templates/stockNews";

test("watchlist normalizes symbols and rejects malformed values", () => {
  assert.equal(normalizeStockSymbol(" meta "), "META");
  assert.throws(() => normalizeStockSymbol("meta stock"), /Invalid stock symbol/);
  assert.throws(() => normalizeStockSymbol(""), /Invalid stock symbol/);
});

test("effective Pro requires both plan and a future expiry", () => {
  const now = new Date("2026-07-14T00:00:00.000Z");
  assert.equal(
    isEffectivePro(
      { plan: "pro", proPlanExpiry: new Date("2026-07-15T00:00:00.000Z") },
      now,
    ),
    true,
  );
  assert.equal(
    isEffectivePro(
      { plan: "pro", proPlanExpiry: new Date("2026-06-17T00:00:00.000Z") },
      now,
    ),
    false,
  );
  assert.equal(isEffectivePro({ plan: "free" }, now), false);
  assert.equal(
    effectivePlan(
      { plan: "pro", proPlanExpiry: new Date("2026-06-17T00:00:00.000Z") },
      now,
    ),
    "free",
  );
});

test("timezone validation and local digest scheduling support IANA zones", () => {
  assert.equal(isValidTimeZone("Africa/Lagos"), true);
  assert.equal(isValidTimeZone("Not/A_Zone"), false);
  assert.deepEqual(
    localDateAndHour(new Date("2026-07-14T07:05:00.000Z"), "Africa/Lagos"),
    { localDate: "2026-07-14", hour: 8 },
  );
  assert.deepEqual(
    shouldScheduleDailyDigest(
      new Date("2026-07-14T07:05:00.000Z"),
      new Date("2026-07-13T12:00:00.000Z"),
      "Africa/Lagos",
    ),
    { eligible: true, localDate: "2026-07-14" },
  );
  assert.equal(
    shouldScheduleDailyDigest(
      new Date("2026-07-14T07:05:00.000Z"),
      new Date("2026-07-14T07:01:00.000Z"),
      "Africa/Lagos",
    ).eligible,
    false,
  );
});

test("stock news readiness distinguishes disabled, misconfigured, and scheduled", () => {
  assert.equal(stockNewsAvailability({ enabled: false }), "disabled");
  assert.equal(
    stockNewsAvailability({
      enabled: true,
      finnhubApiKey: "finnhub",
      openaiApiKey: "openai",
    }),
    "misconfigured",
  );
  assert.equal(
    stockNewsAvailability({
      enabled: true,
      finnhubApiKey: "finnhub",
      openaiApiKey: "openai",
      resendApiKey: "resend",
    }),
    "scheduled",
  );
});

test("delivery health exposes safe timestamps without provider details", () => {
  assert.deepEqual(
    buildStockNewsDeliveryHealth(
      "scheduled",
      {
        status: "completed",
        startedAt: new Date("2026-07-14T07:00:00.000Z"),
        completedAt: new Date("2026-07-14T07:00:04.000Z"),
      },
      { sentAt: new Date("2026-07-13T07:01:00.000Z") },
    ),
    {
      availability: "scheduled",
      lastRunStatus: "completed",
      lastRunAt: "2026-07-14T07:00:04.000Z",
      lastSentAt: "2026-07-13T07:01:00.000Z",
    },
  );
});

test("material-news eligibility ignores silence and pre-activation stories", () => {
  const recipient = {
    preferencesChangedAt: new Date("2026-07-14T06:00:00.000Z"),
    entries: [
      {
        symbol: "META",
        alertsActiveSince: new Date("2026-07-14T06:30:00.000Z"),
      },
    ],
  };
  assert.deepEqual(eligibleMaterialArticles(recipient, []), []);
  const eligible = eligibleMaterialArticles(recipient, [
    {
      symbols: ["META"],
      publishedAt: new Date("2026-07-14T06:20:00.000Z"),
    },
    {
      symbols: ["META"],
      publishedAt: new Date("2026-07-14T06:40:00.000Z"),
    },
  ]);
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0].publishedAt.toISOString(), "2026-07-14T06:40:00.000Z");
});

test("daily delivery keys deduplicate a local date and failures retry three times", () => {
  assert.equal(
    dailyStockNewsDeliveryKey("user-1", "2026-07-14"),
    dailyStockNewsDeliveryKey("user-1", "2026-07-14"),
  );
  assert.equal(stockNewsDeliveryIsRetryable({ status: "failed", attempts: 2 }), true);
  assert.equal(stockNewsDeliveryIsRetryable({ status: "failed", attempts: 3 }), false);
  assert.equal(stockNewsDeliveryIsRetryable({ status: "sent", attempts: 1 }), false);
});

test("news fingerprint removes tracking parameters", () => {
  const first = canonicalNewsFingerprint(
    "Meta appoints a new CEO",
    "https://news.example/story?utm_source=email",
  );
  const second = canonicalNewsFingerprint(
    "  Meta appoints a new CEO ",
    "https://news.example/story",
  );
  assert.equal(first, second);
});

test("stock news templates escape content and avoid trading directions", () => {
  const article = {
    symbols: ["META"],
    headline: "CEO <resigns>",
    source: "Example News",
    publishedAt: new Date("2026-07-14T07:00:00.000Z"),
    summary: "The company confirmed the change.",
    whyItMatters: "Leadership changes can affect company strategy.",
    url: "https://news.example/story",
  };
  const immediate = stockNewsImmediateEmail("Ada", article);
  const digest = stockNewsDigestEmail("Ada", "2026-07-14", [article]);
  assert.match(immediate.html, /CEO &lt;resigns&gt;/);
  assert.match(immediate.html, /Why it matters/);
  assert.match(digest.html, /Manage stock news alerts/);
  assert.doesNotMatch(immediate.html, /\bBUY\b|\bSELL\b/);
});
