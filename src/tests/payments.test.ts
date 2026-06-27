import assert from "node:assert/strict";
import test from "node:test";
import type { ITransaction } from "../models/transaction.model";
import {
  applySuccessfulPayment,
  type ApplyPaymentDeps,
} from "../controllers/payments.controller";

function makeTxn(overrides: Partial<ITransaction> = {}): ITransaction {
  return {
    _id: "txn-1",
    userId: "user-1",
    monthsCount: 3,
    status: "pending",
    ...overrides,
  } as unknown as ITransaction;
}

test("concurrent callers credit a payment exactly once (atomic claim)", async () => {
  let claimsAwarded = 0;
  let activateCalls = 0;
  let referralCalls = 0;
  const monthsSeen: number[] = [];

  const deps: ApplyPaymentDeps = {
    // Models MongoDB's atomic findOneAndUpdate: only the first caller flips
    // pending→success and gets the doc back; the rest get null.
    claim: async (txn) => {
      if (claimsAwarded === 0) {
        claimsAwarded += 1;
        return txn;
      }
      return null;
    },
    activate: async (_userId, months) => {
      activateCalls += 1;
      monthsSeen.push(months);
    },
    creditReferral: async () => {
      referralCalls += 1;
    },
  };

  const txn = makeTxn();
  await Promise.all([
    applySuccessfulPayment(txn, deps),
    applySuccessfulPayment(txn, deps),
    applySuccessfulPayment(txn, deps),
  ]);

  assert.equal(activateCalls, 1, "subscription extended exactly once");
  assert.equal(referralCalls, 1, "referral credited exactly once");
  assert.deepEqual(monthsSeen, [3], "extended by the transaction's monthsCount");
  assert.equal(txn.status, "success");
});

test("a caller that loses the claim does not credit", async () => {
  let activateCalls = 0;
  let referralCalls = 0;

  const deps: ApplyPaymentDeps = {
    claim: async () => null, // someone else already claimed it
    activate: async () => {
      activateCalls += 1;
    },
    creditReferral: async () => {
      referralCalls += 1;
    },
  };

  const txn = makeTxn();
  await applySuccessfulPayment(txn, deps);

  assert.equal(activateCalls, 0);
  assert.equal(referralCalls, 0);
  // Terminal state still reflected for an accurate response payload.
  assert.equal(txn.status, "success");
});

test("the winning caller credits with the claimed doc's months", async () => {
  let usedMonths = -1;
  let creditedTxn: ITransaction | null = null;

  const deps: ApplyPaymentDeps = {
    claim: async () => makeTxn({ monthsCount: 12, userId: "winner" as never }),
    activate: async (userId, months) => {
      usedMonths = months;
      assert.equal(userId, "winner");
    },
    creditReferral: async (txn) => {
      creditedTxn = txn;
    },
  };

  await applySuccessfulPayment(makeTxn(), deps);
  assert.equal(usedMonths, 12);
  assert.ok(creditedTxn, "referral credited with the claimed transaction");
});

test("defaults to 1 month when monthsCount is missing or invalid", async () => {
  let usedMonths = -1;
  const deps: ApplyPaymentDeps = {
    claim: async () => makeTxn({ monthsCount: 0 }),
    activate: async (_userId, months) => {
      usedMonths = months;
    },
    creditReferral: async () => {},
  };

  await applySuccessfulPayment(makeTxn(), deps);
  assert.equal(usedMonths, 1);
});
