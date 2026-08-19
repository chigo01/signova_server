import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  BachsService,
  resolveBachsCustomerName,
} from "../services/bachs.service";
import { bachsTransactionQuery } from "../controllers/payments.controller";

function signBody(
  secret: string,
  body: string,
  timestamp: number,
): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
}

test("Bachs checkout request is crypto-only and priced in USD decimal strings", () => {
  const payload = BachsService.buildCheckoutSessionRequest({
    email: "jane@example.com",
    name: "Jane Doe",
    amountUsd: 100,
    reference: "signova_bachs_pro_user_abc",
    successUrl: "https://app.example.com/pricing",
    cancelUrl: "https://app.example.com/pricing",
    metadata: { userId: "u1", planId: "pro", monthsCount: 1 },
  });

  assert.deepEqual(payload.allowed_payment_method_types, ["crypto"]);
  assert.equal(payload.pricing.currency, "USD");
  assert.equal(payload.pricing.amount, "100.00");
  assert.equal(payload.customer.email, "jane@example.com");
  assert.equal(payload.customer.name, "Jane Doe");
  assert.ok(!JSON.stringify(payload).includes("card"));
  assert.ok(!JSON.stringify(payload).includes("bank_transfer"));
  assert.ok(!JSON.stringify(payload).includes("mobile_money"));
});

test("Bachs customer name falls back to the email local part", () => {
  assert.equal(resolveBachsCustomerName("  Ada  ", "ada@x.com"), "Ada");
  assert.equal(resolveBachsCustomerName(undefined, "trader@signova.app"), "trader");
  assert.equal(resolveBachsCustomerName(" ", "x@y.com"), "x");
});

test("Bachs webhook signature accepts a matching HMAC and rejects tampering", () => {
  const secret = "whsec_test";
  const body = '{"id":"evt_1","type":"collection.succeeded"}';
  const timestamp = 1_700_000_000;
  const signature = signBody(secret, body, timestamp);
  const nowMs = timestamp * 1000;

  assert.equal(
    BachsService.verifyWebhookSignature(body, secret, String(timestamp), signature, nowMs),
    true,
  );
  assert.equal(
    BachsService.verifyWebhookSignature(
      body,
      secret,
      String(timestamp),
      "deadbeef",
      nowMs,
    ),
    false,
  );
  assert.equal(
    BachsService.verifyWebhookSignature(
      '{"id":"evt_1","type":"tampered"}',
      secret,
      String(timestamp),
      signature,
      nowMs,
    ),
    false,
  );
  assert.equal(
    BachsService.verifyWebhookSignature(
      body,
      secret,
      String(timestamp),
      signature,
      nowMs + 301_000,
    ),
    false,
  );
  assert.equal(
    BachsService.verifyWebhookSignature(body, undefined, String(timestamp), signature, nowMs),
    false,
  );
});

test("successful Bachs checkouts credit; underpaid and failed do not", () => {
  assert.equal(
    BachsService.isSuccessfulCheckout({
      checkoutId: "chk_1",
      status: "completed",
      paymentStatus: "succeeded",
      raw: {},
    }),
    true,
  );
  assert.equal(
    BachsService.isSuccessfulCheckout({
      checkoutId: "chk_1",
      status: "completed",
      chargeStatus: "overpaid",
      raw: {},
    }),
    true,
  );
  assert.equal(
    BachsService.isSuccessfulCheckout({
      checkoutId: "chk_1",
      status: "completed",
      chargeStatus: "underpaid",
      paymentStatus: "succeeded",
      raw: {},
    }),
    false,
  );
  assert.equal(
    BachsService.isFailedCheckout({
      checkoutId: "chk_1",
      status: "expired",
      raw: {},
    }),
    true,
  );
  assert.equal(
    BachsService.isFailedCheckout({
      checkoutId: "chk_1",
      status: "open",
      paymentStatus: "processing",
      raw: {},
    }),
    false,
  );
});

test("Bachs webhook lookup prefers checkout_id then reference", () => {
  assert.deepEqual(
    bachsTransactionQuery({
      checkout_id: "chk_abc",
      reference: "signova_bachs_1",
    }),
    { bachsCheckoutId: "chk_abc" },
  );
  assert.deepEqual(
    bachsTransactionQuery({ reference: "signova_bachs_1" }),
    { bachsReference: "signova_bachs_1" },
  );
  assert.equal(bachsTransactionQuery({}), null);
});
