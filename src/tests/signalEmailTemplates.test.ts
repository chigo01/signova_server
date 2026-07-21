import test from "node:test";
import assert from "node:assert/strict";
import { newSignalEmail } from "../services/email/templates/newSignal";

test("new-signal email includes entry details but keeps trade levels private", () => {
  const email = newSignalEmail({
    firstName: "Ada",
    pair: "NZDJPY",
    direction: "BUY",
    entryPrice: 94.43,
    stopLoss: 94.24,
    takeProfit1: 94.62,
    takeProfit2: 94.81,
    timeframe: "4h",
  });

  assert.match(email.html, /Entry price/);
  assert.match(email.html, /94\.43/);
  assert.doesNotMatch(email.html, /Stop loss|94\.24/);
  assert.doesNotMatch(email.html, /Take profit 1 \(TP1\)|94\.62/);
  assert.doesNotMatch(email.html, /Take profit 2 \(TP2\)|94\.81/);
});
