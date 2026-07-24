import assert from "node:assert/strict";
import test from "node:test";
import { toPublicSignal } from "../utils/publicSignal";

test("public signals include release time without exposing protected fields", () => {
  const publicSignal = toPublicSignal({
    _id: "signal-1",
    pair: "EUR/USD",
    direction: "BUY",
    timestamp: "2026-07-16T10:00:00.000Z",
    entryPrice: 1.2345,
    exitTargets: {
      takeProfit1: 1.24,
    },
  });

  assert.deepEqual(publicSignal, {
    _id: "signal-1",
    pair: "EUR/USD",
    direction: "BUY",
    timestamp: "2026-07-16T10:00:00.000Z",
    approvedAt: undefined,
    entryPrice: 1.2345,
    takeProfit1: 1.24,
  });
  assert.equal("stopLoss" in publicSignal, false);
  assert.equal("takeProfit2" in publicSignal, false);
  assert.equal("reasoning" in publicSignal, false);
});

test("public signals expose the admin approval time from the screenshot doc", () => {
  const publicSignal = toPublicSignal({
    _id: "signal-1",
    pair: "EUR/USD",
    direction: "BUY",
    timestamp: "2026-07-24T09:00:02.000Z",
    screenshot: { approvedAt: "2026-07-24T13:45:10.000Z" },
    entryPrice: 1.2345,
    exitTargets: { takeProfit1: 1.24 },
  });

  // The countdown must run from approval, not from the engine analysis time.
  assert.equal(publicSignal.approvedAt, "2026-07-24T13:45:10.000Z");
  assert.equal(publicSignal.timestamp, "2026-07-24T09:00:02.000Z");
});

test("a top-level approvedAt wins over the screenshot copy", () => {
  const publicSignal = toPublicSignal({
    _id: "signal-1",
    approvedAt: "2026-07-24T13:45:10.000Z",
    screenshot: { approvedAt: "2026-07-24T09:00:02.000Z" },
  });

  assert.equal(publicSignal.approvedAt, "2026-07-24T13:45:10.000Z");
});
