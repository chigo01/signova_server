import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidTimeZone,
  normalizeStockSymbol,
} from "../services/watchlist.service";
import {
  effectivePlan,
  isEffectivePro,
} from "../services/planEntitlement.service";
import {
  canonicalNewsFingerprint,
  localDateAndHour,
} from "../services/stockNewsAlert.service";
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
