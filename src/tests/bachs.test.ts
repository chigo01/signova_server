import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  BachsService,
  BACHS_CRYPTO_MIN_USD,
  isBachsCheckoutMethod,
  parseBachsNgnAmount,
  isBachsPublicCallbackUrl,
  resolveBachsCallbackUrl,
  resolveBachsCustomerName,
} from "../services/bachs.service";
import {
  bachsTransactionQuery,
  ownedTransactionLookup,
} from "../controllers/payments.controller";

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

function checkoutInput(
  paymentMethod: "card" | "bank_transfer" | "crypto",
  amountNgn?: string,
) {
  return {
    email: "jane@example.com",
    name: "Jane Doe",
    amountUsd: 39.99,
    amountNgn,
    paymentMethod,
    reference: "signova_bachs_pro_user_abc",
    successUrl: "https://app.example.com/pricing",
    cancelUrl: "https://app.example.com/pricing",
    metadata: { userId: "u1", planId: "pro", monthsCount: 1 as const },
  };
}

test("Bachs card checkout offers USD and NGN cards when an NGN price is present", () => {
  const payload = BachsService.buildCheckoutSessionRequest(
    checkoutInput("card", "53986.50"),
  );

  assert.deepEqual(payload.payment_method_options, {
    card: { currencies: ["USD", "NGN"] },
  });
  assert.deepEqual(payload.pricing, {
    currency: "USD",
    amount: "39.99",
    currency_options: { NGN: "53986.50" },
  });
  assert.equal(payload.billing_currency, undefined);
  assert.ok(!("bank_transfer" in payload.payment_method_options));
  assert.ok(!("crypto" in payload.payment_method_options));
  assert.ok(!JSON.stringify(payload).includes("mobile_money"));
  assert.ok(!("allowed_payment_method_types" in payload));
});

test("Bachs card checkout falls back to USD-only when NGN is missing", () => {
  const payload = BachsService.buildCheckoutSessionRequest(checkoutInput("card"));
  assert.deepEqual(payload.payment_method_options, {
    card: { currencies: ["USD"] },
  });
  assert.deepEqual(payload.pricing, { currency: "USD", amount: "39.99" });
});

test("Bachs bank-transfer checkout adds an NGN price before locking billing to NGN", () => {
  const payload = BachsService.buildCheckoutSessionRequest(
    checkoutInput("bank_transfer", "53986.50"),
  );

  assert.deepEqual(payload.payment_method_options, { bank_transfer: {} });
  assert.deepEqual(payload.pricing, {
    currency: "USD",
    amount: "39.99",
    currency_options: { NGN: "53986.50" },
  });
  assert.equal(payload.billing_currency, "NGN");
  assert.ok(!("card" in payload.payment_method_options));
  assert.ok(!("crypto" in payload.payment_method_options));
});

test("Bachs bank-transfer checkout rejects a USD-only payload", () => {
  assert.throws(
    () => BachsService.buildCheckoutSessionRequest(checkoutInput("bank_transfer")),
    /NGN bank transfer requires an NGN price/,
  );
});

test("parseBachsNgnAmount accepts Bachs decimal strings at or above 100", () => {
  assert.equal(parseBachsNgnAmount("53986.5"), "53986.50");
  assert.equal(parseBachsNgnAmount(100), "100.00");
  assert.equal(parseBachsNgnAmount("99.99"), null);
  assert.equal(parseBachsNgnAmount("not-a-price"), null);
});

test("Bachs crypto checkout is crypto-only", () => {
  const payload = BachsService.buildCheckoutSessionRequest(
    checkoutInput("crypto"),
  );

  assert.deepEqual(payload.payment_method_options, { crypto: {} });
  assert.equal(payload.billing_currency, undefined);
  assert.ok(!("card" in payload.payment_method_options));
  assert.ok(!("bank_transfer" in payload.payment_method_options));
});

test("Bachs crypto checkout rejects amounts below the crypto floor", () => {
  assert.throws(
    () =>
      BachsService.buildCheckoutSessionRequest({
        ...checkoutInput("crypto"),
        amountUsd: BACHS_CRYPTO_MIN_USD - 1,
      }),
    /Bachs crypto requires at least \$3\.00/,
  );
});

test("isBachsCheckoutMethod accepts the three hosted methods only", () => {
  assert.equal(isBachsCheckoutMethod("card"), true);
  assert.equal(isBachsCheckoutMethod("bank_transfer"), true);
  assert.equal(isBachsCheckoutMethod("crypto"), true);
  assert.equal(isBachsCheckoutMethod("mobile_money"), false);
  assert.equal(isBachsCheckoutMethod("paystack"), false);
  assert.equal(isBachsCheckoutMethod(""), false);
  assert.equal(isBachsCheckoutMethod(undefined), false);
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

test("Bachs callback URL skips localhost and uses the first public https origin", () => {
  assert.equal(isBachsPublicCallbackUrl("http://localhost:3001/dashboard/settings/pricing"), false);
  assert.equal(isBachsPublicCallbackUrl("https://web.signova.app/dashboard/settings/pricing"), true);
  assert.equal(
    resolveBachsCallbackUrl({
      frontendUrl: "http://localhost:3001",
      frontendUrls: [
        "http://localhost:3005",
        "http://localhost:3001",
        "https://web.signova.app",
      ],
    }),
    "https://web.signova.app/dashboard/settings/pricing",
  );
  assert.equal(
    resolveBachsCallbackUrl({
      explicit: "https://app.signova.app/dashboard/settings/pricing",
      frontendUrl: "http://localhost:3001",
      frontendUrls: ["https://web.signova.app"],
    }),
    "https://app.signova.app/dashboard/settings/pricing",
  );
  assert.throws(
    () =>
      resolveBachsCallbackUrl({
        frontendUrl: "http://localhost:3001",
        frontendUrls: ["http://127.0.0.1:3001"],
      }),
    /public https success URL/,
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

test("status lookup accepts a Bachs checkout id from the return URL", () => {
  assert.deepEqual(
    ownedTransactionLookup("user-1", "chk_merWKkn4vfMiNwvy"),
    { bachsCheckoutId: "chk_merWKkn4vfMiNwvy", userId: "user-1" },
  );
  assert.deepEqual(
    ownedTransactionLookup("user-1", "69c2d6531e36b881862a15cd"),
    { _id: "69c2d6531e36b881862a15cd", userId: "user-1" },
  );
  assert.equal(ownedTransactionLookup("user-1", "  "), null);
});
