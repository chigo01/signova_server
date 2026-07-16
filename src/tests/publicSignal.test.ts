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
    entryPrice: 1.2345,
    takeProfit1: 1.24,
  });
  assert.equal("stopLoss" in publicSignal, false);
  assert.equal("takeProfit2" in publicSignal, false);
  assert.equal("reasoning" in publicSignal, false);
});
