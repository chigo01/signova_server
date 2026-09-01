import assert from "node:assert/strict";
import test from "node:test";
import { nextProExpiry } from "../services/subscription.service";
import {
  effectivePlan,
  effectiveProExpiry,
} from "../services/planEntitlement.service";

test("a 1-month purchase from August expires 30 days later, not the following year", () => {
  const paidAt = new Date("2026-08-23T12:00:00.000Z");
  const expiry = nextProExpiry(paidAt, null, 1);
  assert.equal(expiry.toISOString(), "2026-09-22T12:00:00.000Z");
});

test("leftover Pro time is extended, not replaced", () => {
  const paidAt = new Date("2026-08-23T12:00:00.000Z");
  const leftover = new Date("2027-01-20T00:00:00.000Z");
  const expiry = nextProExpiry(paidAt, leftover, 1);
  assert.equal(expiry.toISOString(), "2027-02-19T00:00:00.000Z");
});

test("an expired Pro date is ignored so the new month starts now", () => {
  const paidAt = new Date("2026-08-23T12:00:00.000Z");
  const expired = new Date("2026-07-01T00:00:00.000Z");
  const expiry = nextProExpiry(paidAt, expired, 1);
  assert.equal(expiry.toISOString(), "2026-09-22T12:00:00.000Z");
});

test("a native RevenueCat entitlement unlocks Pro without a web payment", () => {
  const now = new Date("2026-09-01T00:00:00.000Z");
  const user = {
    plan: "free" as const,
    mobileSubscription: {
      entitlementActive: true,
      expiresAt: new Date("2026-10-01T00:00:00.000Z"),
    },
  };
  assert.equal(effectivePlan(user, now), "pro");
  assert.equal(
    effectiveProExpiry(user, now)?.toISOString(),
    "2026-10-01T00:00:00.000Z",
  );
});

test("an expired mobile grant cannot remove remaining web Pro access", () => {
  const now = new Date("2026-09-01T00:00:00.000Z");
  const user = {
    plan: "pro" as const,
    proPlanExpiry: new Date("2026-11-01T00:00:00.000Z"),
    mobileSubscription: {
      entitlementActive: false,
      expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    },
  };
  assert.equal(effectivePlan(user, now), "pro");
  assert.equal(
    effectiveProExpiry(user, now)?.toISOString(),
    "2026-11-01T00:00:00.000Z",
  );
});

test("a lifetime native entitlement has no finite expiry", () => {
  const user = {
    plan: "free" as const,
    mobileSubscription: { entitlementActive: true, expiresAt: null },
  };
  assert.equal(effectivePlan(user), "pro");
  assert.equal(effectiveProExpiry(user), undefined);
});
