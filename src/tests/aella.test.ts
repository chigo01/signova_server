import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  AellaService,
  aellaAmountsMatch,
  aellaNgnNumber,
  isFailedAellaStatus,
  isSuccessfulAellaStatus,
  normalizeAellaSecretKey,
} from "../services/aella.service";
import { aellaInwardsAccountNumber } from "../controllers/payments.controller";

function signBody(secret: string, body: string): string {
  return crypto.createHmac("sha512", secret).update(body).digest("hex");
}

test("normalizeAellaSecretKey strips a docs-style underscore after live/test", () => {
  assert.equal(
    normalizeAellaSecretKey("ae_sk_live_abcdef12"),
    "ae_sk_liveabcdef12",
  );
  assert.equal(
    normalizeAellaSecretKey("ae_sk_liveabcdef12"),
    "ae_sk_liveabcdef12",
  );
  assert.equal(
    normalizeAellaSecretKey("ae_sk_test_already_ok"),
    "ae_sk_testalready_ok",
  );
  assert.equal(
    normalizeAellaSecretKey("ae_to_live_xyz"),
    "ae_to_livexyz",
  );
  assert.equal(normalizeAellaSecretKey("  ae_sk_livekeep  "), "ae_sk_livekeep");
  assert.equal(normalizeAellaSecretKey(""), undefined);
});

test("Aella dynamic-account request is NGN major units with a 60-minute expiry", () => {
  const payload = AellaService.buildDynamicAccountRequest({
    accountName: "  Signova Pro  ",
    amountNgn: "53986.50",
  });
  assert.deepEqual(payload, {
    accountName: "Signova Pro",
    amount: 53986.5,
    expiryTimeInMinutes: 60,
  });
});

test("Aella rejects NGN amounts below 100", () => {
  assert.throws(
    () => aellaNgnNumber("99.99"),
    /at least 100/,
  );
});

test("Aella webhook signature accepts a matching HMAC and rejects tampering", () => {
  const jammed = "ae_sk_testsecret";
  const docsStyle = "ae_sk_test_secret";
  const body = '{"event":"inwards.completed"}';
  const signature = signBody(jammed, body);

  assert.equal(
    AellaService.verifyWebhookSignature(body, jammed, signature),
    true,
  );
  assert.equal(
    AellaService.verifyWebhookSignature(body, docsStyle, signature),
    true,
  );
  assert.equal(
    AellaService.verifyWebhookSignature(body, jammed, "deadbeef"),
    false,
  );
  assert.equal(
    AellaService.verifyWebhookSignature(
      '{"event":"tampered"}',
      jammed,
      signature,
    ),
    false,
  );
  assert.equal(
    AellaService.verifyWebhookSignature(body, undefined, signature),
    false,
  );
});

test("Aella amount matching treats Naira decimals as exact", () => {
  assert.equal(aellaAmountsMatch(53986.5, 53986.5), true);
  assert.equal(aellaAmountsMatch(53986.5, "53986.50"), true);
  assert.equal(aellaAmountsMatch(53986.5, 53986), false);
  assert.equal(aellaAmountsMatch(2000, 1999), false);
});

test("Aella inward lookup uses the receiver account number", () => {
  assert.equal(
    aellaInwardsAccountNumber({
      receiverAccountNumber: "0377752164",
      sourceWallet: "vaccount-uuid",
    }),
    "0377752164",
  );
  assert.equal(aellaInwardsAccountNumber({ sourceWallet: "vaccount-uuid" }), null);
});

test("Aella status helpers credit success and fail expired", () => {
  assert.equal(isSuccessfulAellaStatus("Success"), true);
  assert.equal(isSuccessfulAellaStatus("success"), true);
  assert.equal(isFailedAellaStatus("failed"), true);
  assert.equal(isFailedAellaStatus("expired"), true);
  assert.equal(isSuccessfulAellaStatus("pending"), false);
});
