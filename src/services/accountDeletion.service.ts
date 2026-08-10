import crypto from "node:crypto";
import mongoose from "mongoose";
import { ACCOUNT_DELETION_CONSTANTS } from "../config/constants";
import { env } from "../config/env";
import { AppError } from "../middleware/errorHandler";
import AccountDeletion from "../models/accountDeletion.model";
import AffiliatePayout from "../models/affiliate-payout.model";
import ChartLayout from "../models/chartLayout.model";
import ChartTemplate from "../models/chartTemplate.model";
import Deposit from "../models/deposit.model";
import DrawingTemplate from "../models/drawingTemplate.model";
import Journal from "../models/journal.model";
import PushInstallation from "../models/pushInstallation.model";
import ReferralEarning from "../models/referral-earning.model";
import SigcoinLedger from "../models/sigcoin-ledger.model";
import SignalPlay from "../models/signalPlay.model";
import StockNewsDelivery from "../models/stockNewsDelivery.model";
import StudyTemplate from "../models/studyTemplate.model";
import Transaction from "../models/transaction.model";
import User from "../models/user.model";
import UserWatchlist from "../models/userWatchlist.model";
import { AppleAuthService } from "./apple-auth.service";
import { sendEmail } from "./email/email.service";
import {
  accountDeletionCancelledEmail,
  accountDeletionCompletedEmail,
  accountDeletionRequestedEmail,
} from "./email/templates/accountDeletion";
import { deriveFirstName } from "./email/templates/_shared";

export type DeletionPlatform = (typeof ACCOUNT_DELETION_CONSTANTS.PLATFORMS)[number];

/** The shape returned to clients — the reason is deliberately not included. */
export interface PendingDeletion {
  requestedAt: Date;
  scheduledFor: Date;
}

/** The minimum a document needs for `deletionState` to read it. */
interface DeletionFields {
  deletionRequestedAt?: Date | null;
  deletionScheduledFor?: Date | null;
}

/**
 * Personal data. Every one of these collections is destroyed outright when an
 * account is purged. Keyed by the collection's user field.
 */
const PERSONAL_COLLECTIONS = [
  { name: "journals", model: Journal, field: "userId" },
  { name: "signalPlays", model: SignalPlay, field: "userId" },
  { name: "chartLayouts", model: ChartLayout, field: "userId" },
  { name: "chartTemplates", model: ChartTemplate, field: "userId" },
  { name: "studyTemplates", model: StudyTemplate, field: "userId" },
  { name: "drawingTemplates", model: DrawingTemplate, field: "userId" },
  { name: "userWatchlists", model: UserWatchlist, field: "userId" },
  { name: "pushInstallations", model: PushInstallation, field: "userId" },
  { name: "stockNewsDeliveries", model: StockNewsDelivery, field: "userId" },
] as const;

export interface PurgeDeps {
  /**
   * Atomically claims the account for purging. Returns null when the request
   * was revoked, is not due yet, or another worker already claimed it.
   */
  claim: (userId: string, now: Date) => Promise<{
    _id: unknown;
    email: string;
    name?: string;
    deletionRequestedAt?: Date;
    deletionScheduledFor?: Date;
    deletionRequestedFrom?: string;
    appleRefreshTokenEncrypted?: string;
  } | null>;
  /** Best-effort final notice, sent before we lose the address. */
  notify: (email: string, name?: string) => Promise<void>;
  /** Apple requires the Sign in with Apple grant be revoked on deletion. */
  revokeAppleToken: (encryptedRefreshToken: string) => Promise<boolean>;
  /** Repoints a financial collection's user reference at the synthetic id. */
  anonymize: (
    collection: string,
    userId: string,
    anonymizedRef: mongoose.Types.ObjectId
  ) => Promise<number>;
  /** Destroys one personal-data collection for this user. */
  deletePersonal: (collection: string, userId: string) => Promise<number>;
  /** Clears `referredBy` on users this account referred. */
  detachReferrals: (userId: string) => Promise<number>;
  deleteUser: (userId: string) => Promise<void>;
  recordAudit: (record: {
    anonymizedRef: mongoose.Types.ObjectId;
    emailHash: string;
    requestedAt?: Date;
    scheduledFor?: Date;
    platform?: string;
    appleTokenRevoked: boolean | null;
    deletedCounts: Record<string, number>;
    anonymizedCounts: Record<string, number>;
  }) => Promise<void>;
}

export interface PurgeResult {
  purged: boolean;
  deletedCounts: Record<string, number>;
  anonymizedCounts: Record<string, number>;
}

export class AccountDeletionService {
  /**
   * The pending-deletion state surfaced to clients on login and on
   * `GET /auth/check`. Null when there is no request outstanding.
   */
  static deletionState(user: DeletionFields | null | undefined): PendingDeletion | null {
    if (!user?.deletionScheduledFor || !user.deletionRequestedAt) return null;
    return {
      requestedAt: user.deletionRequestedAt,
      scheduledFor: user.deletionScheduledFor,
    };
  }

  static scheduledForFrom(requestedAt: Date): Date {
    return new Date(
      requestedAt.getTime() +
        env.ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000
    );
  }

  /**
   * Schedules the account for deletion. Idempotent: a second request while one
   * is already pending returns the existing state and does not push the date
   * out, so a user cannot keep an account alive by re-requesting deletion.
   */
  static async requestDeletion(
    userId: string,
    options: { reason?: string; platform?: DeletionPlatform } = {}
  ): Promise<PendingDeletion> {
    const user = await User.findById(userId);
    if (!user) throw new AppError(404, "User not found");

    const existing = this.deletionState(user);
    if (existing) return existing;

    const requestedAt = new Date();
    const scheduledFor = this.scheduledForFrom(requestedAt);

    user.deletionRequestedAt = requestedAt;
    user.deletionScheduledFor = scheduledFor;
    user.deletionReason = options.reason;
    user.deletionRequestedFrom = options.platform ?? "unknown";
    await user.save();

    // Best effort: sendEmail throws on a Resend failure by design, and a mail
    // outage must not make the deletion request itself look like it failed.
    try {
      const { subject, html } = accountDeletionRequestedEmail({
        firstName: deriveFirstName(user.name),
        scheduledFor,
        graceDays: env.ACCOUNT_DELETION_GRACE_DAYS,
      });
      await sendEmail({ to: user.email, subject, html });
    } catch (error) {
      console.error("Account deletion: request email failed", error);
    }

    return { requestedAt, scheduledFor };
  }

  /**
   * Cancels a pending deletion. Always succeeds so a double-click is harmless;
   * the confirmation email only goes out when a request actually existed.
   *
   * The `deletionPurgeStartedAt` guard is what makes this safe against the cron:
   * once the purge has claimed the account, this matches nothing and the user is
   * told the request could not be cancelled rather than being left half-deleted.
   */
  static async revokeDeletion(userId: string): Promise<{ revoked: boolean }> {
    const user = await User.findOneAndUpdate(
      {
        _id: userId,
        deletionScheduledFor: { $exists: true },
        deletionPurgeStartedAt: { $exists: false },
      },
      {
        $unset: {
          deletionRequestedAt: "",
          deletionScheduledFor: "",
          deletionReason: "",
          deletionRequestedFrom: "",
        },
      }
    );

    if (!user) return { revoked: false };

    try {
      const { subject, html } = accountDeletionCancelledEmail({
        firstName: deriveFirstName(user.name),
      });
      await sendEmail({ to: user.email, subject, html });
    } catch (error) {
      console.error("Account deletion: cancellation email failed", error);
    }

    return { revoked: true };
  }

  /**
   * Irreversibly destroys one account. Ordered so that a crash at any point
   * leaves a state the next run can finish: the claim is taken first, every
   * step is idempotent, and the User document — the thing that gates login — is
   * removed last so a half-finished purge never strands a usable account.
   */
  static async purgeUser(
    userId: string,
    deps: PurgeDeps = defaultPurgeDeps,
    now: Date = new Date()
  ): Promise<PurgeResult> {
    const deletedCounts: Record<string, number> = {};
    const anonymizedCounts: Record<string, number> = {};

    // 1. Claim. Losing here means the user revoked, the request is not due, or
    //    another worker is already on it.
    const user = await deps.claim(userId, now);
    if (!user) return { purged: false, deletedCounts, anonymizedCounts };

    // 2. Final notice, while we still have somewhere to send it.
    try {
      await deps.notify(user.email, user.name);
    } catch (error) {
      console.error("Account deletion: completion email failed", error);
    }

    // 3. Apple requires the Sign in with Apple grant be revoked on deletion.
    let appleTokenRevoked: boolean | null = null;
    if (user.appleRefreshTokenEncrypted) {
      try {
        appleTokenRevoked = await deps.revokeAppleToken(
          user.appleRefreshTokenEncrypted
        );
      } catch (error) {
        console.error("Account deletion: Apple revocation failed", error);
        appleTokenRevoked = false;
      }
    }

    // 4. Anonymize retained financial records.
    const anonymizedRef = new mongoose.Types.ObjectId();
    for (const collection of MONEY_COLLECTIONS) {
      anonymizedCounts[collection] =
        (anonymizedCounts[collection] ?? 0) +
        (await deps.anonymize(collection, userId, anonymizedRef));
    }

    // 5. Destroy personal data.
    for (const { name } of PERSONAL_COLLECTIONS) {
      deletedCounts[name] = await deps.deletePersonal(name, userId);
    }

    // 6. Detach the referral graph so referred users are not left pointing at a
    //    missing account. Referrers keep SIGcoins already earned.
    deletedCounts.referralLinksDetached = await deps.detachReferrals(userId);

    // 7. Remove the account. From here the existing `User.exists` check in
    //    auth middleware 401s every live session for this user.
    await deps.deleteUser(userId);

    // 8. Proof of deletion. Failing here must not resurrect the account, so it
    //    is logged loudly rather than thrown.
    try {
      await deps.recordAudit({
        anonymizedRef,
        emailHash: hashEmail(user.email),
        requestedAt: user.deletionRequestedAt,
        scheduledFor: user.deletionScheduledFor,
        platform: user.deletionRequestedFrom,
        appleTokenRevoked,
        deletedCounts,
        anonymizedCounts,
      });
    } catch (error) {
      console.error(
        `Account deletion: audit record failed for purged user ${userId}`,
        error
      );
    }

    return { purged: true, deletedCounts, anonymizedCounts };
  }

  /**
   * One cron tick: purge everything past its grace window, then reclaim any
   * account whose purge was interrupted (process restart mid-cascade).
   */
  static async runDuePurges(
    deps: PurgeDeps = defaultPurgeDeps
  ): Promise<{ purged: number; failed: number }> {
    const now = new Date();
    let purged = 0;
    let failed = 0;

    // Release stale claims first so an interrupted purge is picked up by the
    // due query below in this same tick. Every purge step is idempotent, so
    // re-running one that partially completed is safe.
    const staleBefore = new Date(
      now.getTime() - ACCOUNT_DELETION_CONSTANTS.STALE_PURGE_RETRY_MS
    );
    const reclaimed = await User.updateMany(
      { deletionPurgeStartedAt: { $lte: staleBefore } },
      { $unset: { deletionPurgeStartedAt: "" } }
    );
    if (reclaimed.modifiedCount > 0) {
      console.warn(
        `⚠️  Account deletion: reclaimed ${reclaimed.modifiedCount} interrupted purge(s)`
      );
    }

    const due = await User.find({
      deletionScheduledFor: { $lte: now },
      deletionPurgeStartedAt: { $exists: false },
    })
      .select("_id")
      .limit(ACCOUNT_DELETION_CONSTANTS.PURGE_BATCH);

    for (const candidate of due) {
      const id = String(candidate._id);
      try {
        const result = await this.purgeUser(id, deps, now);
        if (result.purged) purged += 1;
      } catch (error) {
        failed += 1;
        console.error(`❌ Account deletion: purge failed for ${id}`, error);
      }
    }

    if (purged > 0 || failed > 0) {
      console.log(
        `🗑️  Account deletion: purged ${purged}, failed ${failed}`
      );
    }
    return { purged, failed };
  }
}

/**
 * SHA-256 of the normalized email. Lets support answer "was this address
 * deleted?" without us retaining the address after deletion.
 */
export function hashEmail(email: string): string {
  return crypto
    .createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex");
}

/** Names accepted by `PurgeDeps.anonymize`, in the order the purge applies them. */
export const MONEY_COLLECTIONS = [
  "transactions",
  "deposits",
  "sigcoinLedger",
  "affiliatePayouts",
  "referralEarningsAsReferrer",
  "referralEarningsAsReferred",
] as const;

export const PERSONAL_COLLECTION_NAMES = PERSONAL_COLLECTIONS.map(
  (entry) => entry.name
);

const personalModelsByName = new Map<string, mongoose.Model<any>>(
  PERSONAL_COLLECTIONS.map((entry) => [
    entry.name,
    entry.model as unknown as mongoose.Model<any>,
  ])
);

export const defaultPurgeDeps: PurgeDeps = {
  claim: async (userId, now) => {
    // `+field` on its own adds the select:false token to the default projection.
    // `new: true` is not needed — we only read fields the claim does not touch —
    // but keeping it means the returned doc reflects the claim we just took.
    const claimed = await User.findOneAndUpdate(
      {
        _id: userId,
        deletionScheduledFor: { $lte: now },
        deletionPurgeStartedAt: { $exists: false },
      },
      { $set: { deletionPurgeStartedAt: now } },
      { new: true }
    )
      .select("+appleRefreshTokenEncrypted")
      .lean();
    return claimed as Awaited<ReturnType<PurgeDeps["claim"]>>;
  },

  notify: async (email, name) => {
    const { subject, html } = accountDeletionCompletedEmail({
      firstName: deriveFirstName(name),
    });
    await sendEmail({ to: email, subject, html });
  },

  revokeAppleToken: (encryptedRefreshToken) =>
    AppleAuthService.revokeRefreshToken(encryptedRefreshToken),

  anonymize: async (collection, userId, anonymizedRef) => {
    const id = new mongoose.Types.ObjectId(userId);
    switch (collection) {
      case "transactions":
        return (
          await Transaction.updateMany(
            { userId: id },
            { $set: { userId: anonymizedRef } }
          )
        ).modifiedCount;
      case "deposits":
        return (
          await Deposit.updateMany(
            { userId: id },
            { $set: { userId: anonymizedRef } }
          )
        ).modifiedCount;
      case "sigcoinLedger":
        return (
          await SigcoinLedger.updateMany(
            { userId: id },
            { $set: { userId: anonymizedRef } }
          )
        ).modifiedCount;
      case "affiliatePayouts":
        return (
          await AffiliatePayout.updateMany(
            { affiliateId: id },
            { $set: { affiliateId: anonymizedRef } }
          )
        ).modifiedCount;
      case "referralEarningsAsReferrer":
        return (
          await ReferralEarning.updateMany(
            { referrerId: id },
            { $set: { referrerId: anonymizedRef } }
          )
        ).modifiedCount;
      case "referralEarningsAsReferred":
        return (
          await ReferralEarning.updateMany(
            { referredUserId: id },
            { $set: { referredUserId: anonymizedRef } }
          )
        ).modifiedCount;
      default:
        throw new Error(`Unknown financial collection: ${collection}`);
    }
  },

  deletePersonal: async (collection, userId) => {
    const model = personalModelsByName.get(collection);
    if (!model) throw new Error(`Unknown personal collection: ${collection}`);
    const result = await model.deleteMany({
      userId: new mongoose.Types.ObjectId(userId),
    });
    return result.deletedCount ?? 0;
  },

  detachReferrals: async (userId) => {
    const result = await User.updateMany(
      { referredBy: new mongoose.Types.ObjectId(userId) },
      { $unset: { referredBy: "" } }
    );
    return result.modifiedCount ?? 0;
  },

  deleteUser: async (userId) => {
    await User.deleteOne({ _id: userId });
  },

  recordAudit: async (record) => {
    await AccountDeletion.create({ ...record, purgedAt: new Date() });
  },
};
