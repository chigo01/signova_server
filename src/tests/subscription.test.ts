import assert from "node:assert/strict";
import test from "node:test";
import { nextProExpiry } from "../services/subscription.service";

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
