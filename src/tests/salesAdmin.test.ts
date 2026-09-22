import assert from "node:assert/strict";
import test from "node:test";
import { isEffectivePro, effectivePlan } from "../services/planEntitlement.service";

test("isEffectivePro correctly identifies active Pro users across web and mobile", () => {
  const future = new Date(Date.now() + 100_000_000);
  const past = new Date(Date.now() - 100_000_000);

  // Active web Pro
  assert.equal(
    isEffectivePro({
      plan: "pro",
      proPlanExpiry: future,
    }),
    true,
  );

  // Expired web Pro
  assert.equal(
    isEffectivePro({
      plan: "pro",
      proPlanExpiry: past,
    }),
    false,
  );

  // Free user
  assert.equal(
    isEffectivePro({
      plan: "free",
    }),
    false,
  );

  // Mobile Pro active
  assert.equal(
    isEffectivePro({
      plan: "free",
      mobileSubscription: {
        entitlementActive: true,
        expiresAt: future,
      },
    }),
    true,
  );

  // Mobile Pro expired
  assert.equal(
    isEffectivePro({
      plan: "free",
      mobileSubscription: {
        entitlementActive: true,
        expiresAt: past,
      },
    }),
    false,
  );

  // Mobile lifetime Pro (null expiresAt)
  assert.equal(
    isEffectivePro({
      plan: "free",
      mobileSubscription: {
        entitlementActive: true,
        expiresAt: null,
      },
    }),
    true,
  );
});

test("effectivePlan returns correct plan designation", () => {
  const future = new Date(Date.now() + 100_000_000);
  assert.equal(effectivePlan({ plan: "pro", proPlanExpiry: future }), "pro");
  assert.equal(effectivePlan({ plan: "pro", proPlanExpiry: null }), "free");
  assert.equal(effectivePlan({ plan: "free" }), "free");
});
