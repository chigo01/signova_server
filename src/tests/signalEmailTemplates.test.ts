import test from "node:test";
import assert from "node:assert/strict";
import { newSignalEmail } from "../services/email/templates/newSignal";

test("new-signal email clearly includes entry, stop loss, TP1, and TP2", () => {
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
  assert.match(email.html, /Stop loss/);
  assert.match(email.html, /94\.24/);
  assert.match(email.html, /Take profit 1 \(TP1\)/);
  assert.match(email.html, /94\.62/);
  assert.match(email.html, /Take profit 2 \(TP2\)/);
  assert.match(email.html, /94\.81/);
});
