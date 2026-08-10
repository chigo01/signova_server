import assert from "node:assert/strict";
import test, { mock } from "node:test";
import mongoose from "mongoose";
import {
  AccountDeletionService,
  MONEY_COLLECTIONS,
  PERSONAL_COLLECTION_NAMES,
  PurgeDeps,
  hashEmail,
} from "../services/accountDeletion.service";
import { env } from "../config/env";

type ClaimedUser = Awaited<ReturnType<PurgeDeps["claim"]>>;

interface PurgeCalls {
  notified: Array<{ email: string; name?: string }>;
  appleRevocations: string[];
  anonymized: Array<{ collection: string; ref: string }>;
  deleted: string[];
  detached: string[];
  userDeleted: string[];
  audits: Array<Record<string, unknown>>;
  order: string[];
}

function makeDeps(
  claimed: ClaimedUser,
  overrides: Partial<PurgeDeps> = {}
): { deps: PurgeDeps; calls: PurgeCalls } {
  const calls: PurgeCalls = {
    notified: [],
    appleRevocations: [],
    anonymized: [],
    deleted: [],
    detached: [],
    userDeleted: [],
    audits: [],
    order: [],
  };

  const deps: PurgeDeps = {
    claim: async () => {
      calls.order.push("claim");
      return claimed;
    },
    notify: async (email, name) => {
      calls.order.push("notify");
      calls.notified.push({ email, name });
    },
    revokeAppleToken: async (token) => {
      calls.order.push("revokeApple");
      calls.appleRevocations.push(token);
      return true;
    },
    anonymize: async (collection, _userId, ref) => {
      calls.order.push(`anonymize:${collection}`);
      calls.anonymized.push({ collection, ref: String(ref) });
      return 1;
    },
    deletePersonal: async (collection) => {
      calls.order.push(`delete:${collection}`);
      calls.deleted.push(collection);
      return 2;
    },
    detachReferrals: async (userId) => {
      calls.order.push("detachReferrals");
      calls.detached.push(userId);
      return 3;
    },
    deleteUser: async (userId) => {
      calls.order.push("deleteUser");
      calls.userDeleted.push(userId);
    },
    recordAudit: async (record) => {
      calls.order.push("recordAudit");
      calls.audits.push(record as unknown as Record<string, unknown>);
    },
    ...overrides,
  };

  return { deps, calls };
}

function makeClaimedUser(
  overrides: Partial<NonNullable<ClaimedUser>> = {}
): NonNullable<ClaimedUser> {
  return {
    _id: new mongoose.Types.ObjectId(),
    email: "trader@example.com",
    name: "Ada Trader",
    deletionRequestedAt: new Date("2026-01-01T00:00:00Z"),
    deletionScheduledFor: new Date("2026-01-31T00:00:00Z"),
    deletionRequestedFrom: "web",
    ...overrides,
  };
}

test("deletionState is null until a deletion is actually scheduled", () => {
  assert.equal(AccountDeletionService.deletionState(null), null);
  assert.equal(AccountDeletionService.deletionState(undefined), null);
  assert.equal(AccountDeletionService.deletionState({}), null);
  // A half-written record (one date without the other) must not read as pending —
  // the client would show an "undo" banner with no date to show.
  assert.equal(
    AccountDeletionService.deletionState({
      deletionRequestedAt: new Date(),
    }),
    null
  );
  assert.equal(
    AccountDeletionService.deletionState({
      deletionScheduledFor: new Date(),
    }),
    null
  );
});

test("deletionState exposes both dates and nothing else", () => {
  const requestedAt = new Date("2026-03-01T09:00:00Z");
  const scheduledFor = new Date("2026-03-31T09:00:00Z");
  const state = AccountDeletionService.deletionState({
    deletionRequestedAt: requestedAt,
    deletionScheduledFor: scheduledFor,
  });

  assert.deepEqual(state, { requestedAt, scheduledFor });
  // The reason a user gave is internal — it must never reach the client.
  assert.deepEqual(Object.keys(state ?? {}), ["requestedAt", "scheduledFor"]);
});

test("scheduledFor lands exactly one grace window after the request", () => {
  const requestedAt = new Date("2026-05-10T12:00:00Z");
  const scheduledFor = AccountDeletionService.scheduledForFrom(requestedAt);
  const expectedMs =
    env.ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000;

  assert.equal(scheduledFor.getTime() - requestedAt.getTime(), expectedMs);
  assert.equal(env.ACCOUNT_DELETION_GRACE_DAYS, 30);
});

test("purgeUser anonymizes every financial collection with one shared ref", async () => {
  const claimed = makeClaimedUser();
  const { deps, calls } = makeDeps(claimed);

  const result = await AccountDeletionService.purgeUser(
    String(claimed._id),
    deps
  );

  assert.equal(result.purged, true);
  assert.deepEqual(
    calls.anonymized.map((entry) => entry.collection),
    [...MONEY_COLLECTIONS]
  );
  // ReferralEarning is touched twice on purpose: the deleted user appears both
  // as the referrer on their own earnings and as the referred party on someone
  // else's. Both must be scrubbed.
  assert.ok(
    MONEY_COLLECTIONS.includes("referralEarningsAsReferrer") &&
      MONEY_COLLECTIONS.includes("referralEarningsAsReferred")
  );
  // One synthetic id across every row keeps the accounting groupable.
  const refs = new Set(calls.anonymized.map((entry) => entry.ref));
  assert.equal(refs.size, 1);
  assert.notEqual([...refs][0], String(claimed._id));
});

test("purgeUser deletes every personal collection and detaches referrals", async () => {
  const claimed = makeClaimedUser();
  const userId = String(claimed._id);
  const { deps, calls } = makeDeps(claimed);

  const result = await AccountDeletionService.purgeUser(userId, deps);

  assert.deepEqual(calls.deleted, PERSONAL_COLLECTION_NAMES);
  assert.deepEqual(calls.detached, [userId]);
  assert.deepEqual(calls.userDeleted, [userId]);
  assert.equal(result.deletedCounts.journals, 2);
  assert.equal(result.deletedCounts.referralLinksDetached, 3);
});

test("purgeUser removes the user only after its data, and audits last", async () => {
  const claimed = makeClaimedUser();
  const { deps, calls } = makeDeps(claimed);

  await AccountDeletionService.purgeUser(String(claimed._id), deps);

  const deleteUserAt = calls.order.indexOf("deleteUser");
  const lastDataWriteAt = Math.max(
    ...calls.order
      .map((step, index) =>
        step.startsWith("anonymize:") ||
        step.startsWith("delete:") ||
        step === "detachReferrals"
          ? index
          : -1
      )
      .filter((index) => index >= 0)
  );

  // The User document is the thing auth middleware checks. Removing it last
  // means an interrupted purge leaves an account that still logs in and can be
  // retried, never a live account whose data has silently vanished.
  assert.ok(deleteUserAt > lastDataWriteAt);
  assert.equal(calls.order.at(-1), "recordAudit");
  // The final notice goes out before anything is destroyed — afterwards we no
  // longer have an address to send it to.
  assert.ok(calls.order.indexOf("notify") < lastDataWriteAt);
});

test("purgeUser stores a hashed email, never the address itself", async () => {
  const claimed = makeClaimedUser({ email: "trader@example.com" });
  const { deps, calls } = makeDeps(claimed);

  await AccountDeletionService.purgeUser(String(claimed._id), deps);

  const audit = calls.audits[0];
  assert.equal(audit.emailHash, hashEmail("trader@example.com"));
  assert.equal(JSON.stringify(audit).includes("trader@example.com"), false);
  assert.equal(audit.platform, "web");
});

test("hashEmail normalizes case and surrounding whitespace", () => {
  assert.equal(hashEmail("  Trader@Example.COM "), hashEmail("trader@example.com"));
  assert.notEqual(hashEmail("a@example.com"), hashEmail("b@example.com"));
});

test("purgeUser does nothing when the claim is lost", async () => {
  const { deps, calls } = makeDeps(null);

  const result = await AccountDeletionService.purgeUser("someone", deps);

  // A revoked request, a not-yet-due account, or another worker already on it.
  assert.deepEqual(result, {
    purged: false,
    deletedCounts: {},
    anonymizedCounts: {},
  });
  assert.deepEqual(calls.order, ["claim"]);
});

test("purgeUser skips Apple revocation when the account has no Apple grant", async () => {
  const claimed = makeClaimedUser();
  const { deps, calls } = makeDeps(claimed);

  await AccountDeletionService.purgeUser(String(claimed._id), deps);

  assert.deepEqual(calls.appleRevocations, []);
  assert.equal(calls.audits[0].appleTokenRevoked, null);
});

test("purgeUser revokes the Apple grant when one is stored", async () => {
  const claimed = makeClaimedUser({
    appleRefreshTokenEncrypted: "iv.tag.cipher",
  });
  const { deps, calls } = makeDeps(claimed);

  await AccountDeletionService.purgeUser(String(claimed._id), deps);

  assert.deepEqual(calls.appleRevocations, ["iv.tag.cipher"]);
  assert.equal(calls.audits[0].appleTokenRevoked, true);
});

test("a failed Apple revocation still deletes the account", async () => {
  const claimed = makeClaimedUser({
    appleRefreshTokenEncrypted: "iv.tag.cipher",
  });
  const { deps, calls } = makeDeps(claimed, {
    revokeAppleToken: async () => {
      throw new Error("Apple is down");
    },
  });

  const result = await AccountDeletionService.purgeUser(
    String(claimed._id),
    deps
  );

  // An Apple outage must not leave us holding data we promised to delete.
  assert.equal(result.purged, true);
  assert.deepEqual(calls.userDeleted, [String(claimed._id)]);
  assert.equal(calls.audits[0].appleTokenRevoked, false);
});

test("a failed completion email still deletes the account", async () => {
  const claimed = makeClaimedUser();
  const { deps, calls } = makeDeps(claimed, {
    notify: async () => {
      throw new Error("Resend rejected the send");
    },
  });

  const result = await AccountDeletionService.purgeUser(
    String(claimed._id),
    deps
  );

  assert.equal(result.purged, true);
  assert.deepEqual(calls.userDeleted, [String(claimed._id)]);
});

test("a failed audit write does not resurrect the deleted account", async () => {
  const claimed = makeClaimedUser();
  const errorSpy = mock.method(console, "error", () => {});
  const { deps, calls } = makeDeps(claimed, {
    recordAudit: async () => {
      throw new Error("audit collection unavailable");
    },
  });

  try {
    const result = await AccountDeletionService.purgeUser(
      String(claimed._id),
      deps
    );
    assert.equal(result.purged, true);
    assert.deepEqual(calls.userDeleted, [String(claimed._id)]);
    assert.ok(errorSpy.mock.callCount() > 0);
  } finally {
    mock.restoreAll();
  }
});
