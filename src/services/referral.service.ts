import mongoose from "mongoose";
import User, { IUser } from "../models/user.model";
import ReferralEarning from "../models/referral-earning.model";
import SigcoinLedger from "../models/sigcoin-ledger.model";
import { ITransaction } from "../models/transaction.model";
import { PLANS, isPlanId } from "../config/plans";
import { env } from "../config/env";
import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  REFERRAL_COMMISSION_RATE,
  SIGCOINS_PER_PAYMENT,
  SIGCOINS_PER_VERIFIED_SIGNUP,
} from "../config/referral";

export interface ReferralOverview {
  code: string;
  shareUrl: string;
  stats: {
    totalEarningsUsdMicro: number;
    totalReferrals: number;
    sigcoins: number;
    leaderboardRank: number | null;
  };
  wallet: {
    balanceUsdMicro: number;
    pendingUsdMicro: number;
  };
}

export interface ReferralTransactionRow {
  id: string;
  sourceTransactionId: string;
  referredName: string;
  planId: string;
  amountUsdMicro: number;
  sigcoinsAwarded: number;
  status: string;
  createdAt: Date;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  totalEarningsUsdMicro: number;
  isCurrentUser: boolean;
}

const LEADERBOARD_SIZE = 10;

function randomCode(): string {
  let out = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    out += REFERRAL_CODE_ALPHABET.charAt(
      Math.floor(Math.random() * REFERRAL_CODE_ALPHABET.length),
    );
  }
  return out;
}

function displayName(user: { name?: string; email?: string } | null): string {
  if (!user) return "Unknown";
  if (user.name && user.name.trim()) return user.name.trim();
  if (user.email) return user.email.split("@")[0];
  return "Unknown";
}

export class ReferralService {
  /** Generate a referral code not already in use. */
  static async generateReferralCode(): Promise<string> {
    // Retry on the rare collision against the unique index.
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = randomCode();
      const existing = await User.exists({ referralCode: code });
      if (!existing) return code;
    }
    // Fall back to an effectively-unique code rather than failing the request.
    return `${randomCode()}${Date.now().toString(36).toUpperCase().slice(-4)}`;
  }

  /** Ensure a user has a referral code, generating one lazily if missing. */
  static async ensureReferralCode(user: IUser): Promise<string> {
    if (user.referralCode) return user.referralCode;
    const code = await this.generateReferralCode();
    user.referralCode = code;
    await user.save();
    return code;
  }

  /**
   * Link a freshly-created user to their referrer by code. Idempotent and
   * defensive: ignores unknown codes, self-referral, and re-referral. Does not
   * award SIGcoins here — the signup bonus is granted on first verified login
   * (see creditReferralSignup, called from the once-per-user welcome gate).
   */
  static async attachReferrer(
    newUser: IUser,
    code: unknown,
  ): Promise<void> {
    if (newUser.referredBy) return;
    if (typeof code !== "string") return;
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;

    const referrer = await User.findOne({ referralCode: normalized });
    if (!referrer) return;
    if (String(referrer._id) === String(newUser._id)) return; // no self-referral

    newUser.referredBy = referrer._id as mongoose.Types.ObjectId;
    await newUser.save();
  }

  /**
   * Award the referrer their signup bonus the first time a referred user is
   * verified. Guarded so it runs at most once per referred user.
   */
  static async creditReferralSignup(referredUser: IUser): Promise<void> {
    if (!referredUser.referredBy) return;
    try {
      await this.awardSigcoins(
        referredUser.referredBy,
        SIGCOINS_PER_VERIFIED_SIGNUP,
        "referral_signup",
        referredUser._id as mongoose.Types.ObjectId,
      );
    } catch (err) {
      // Referral accounting must never break the auth flow.
      console.error("creditReferralSignup failed", err);
    }
  }

  /**
   * Credit the referrer when a referred user's subscription payment succeeds.
   * Recurring: runs on every successful payment. Idempotent via the unique
   * `sourceTransactionId` index on ReferralEarning. Never throws.
   */
  static async creditReferralForPayment(
    transaction: ITransaction,
  ): Promise<void> {
    try {
      const referredUser = await User.findById(transaction.userId);
      if (!referredUser || !referredUser.referredBy) return;
      if (!isPlanId(transaction.planId)) return;

      const plan = PLANS[transaction.planId];
      const amountUsdMicro = Math.round(
        plan.displayUsd * 1_000_000 * REFERRAL_COMMISSION_RATE,
      );

      // Idempotency: insert first; a duplicate key means it was already credited.
      try {
        await ReferralEarning.create({
          referrerId: referredUser.referredBy,
          referredUserId: referredUser._id,
          sourceTransactionId: transaction._id,
          planId: transaction.planId,
          amountUsdMicro,
          sigcoinsAwarded: SIGCOINS_PER_PAYMENT,
          status: "pending",
        });
      } catch (err: unknown) {
        const e = err as { code?: number };
        if (e.code === 11000) return; // already credited for this transaction
        throw err;
      }

      await User.updateOne(
        { _id: referredUser.referredBy },
        { $inc: { referralPendingUsdMicro: amountUsdMicro } },
      );

      await this.awardSigcoins(
        referredUser.referredBy as mongoose.Types.ObjectId,
        SIGCOINS_PER_PAYMENT,
        "referral_payment",
        transaction._id as mongoose.Types.ObjectId,
      );
    } catch (err) {
      console.error("creditReferralForPayment failed", err);
    }
  }

  /** Append a SIGcoin ledger entry and keep the denormalized balance in sync. */
  private static async awardSigcoins(
    userId: mongoose.Types.ObjectId,
    delta: number,
    reason: "referral_signup" | "referral_payment",
    refId?: mongoose.Types.ObjectId,
  ): Promise<void> {
    const updated = await User.findByIdAndUpdate(
      userId,
      { $inc: { sigcoins: delta } },
      { new: true },
    );
    if (!updated) return;
    await SigcoinLedger.create({
      userId,
      delta,
      reason,
      refId,
      balanceAfter: updated.sigcoins,
    });
  }

  static async getOverview(user: IUser): Promise<ReferralOverview> {
    const code = await this.ensureReferralCode(user);
    const totalReferrals = await User.countDocuments({ referredBy: user._id });
    const leaderboardRank = await this.getRank(user);

    return {
      code,
      shareUrl: `${env.FRONTEND_URL.replace(/\/$/, "")}/register?ref=${code}`,
      stats: {
        totalEarningsUsdMicro:
          user.referralBalanceUsdMicro + user.referralPendingUsdMicro,
        totalReferrals,
        sigcoins: user.sigcoins,
        leaderboardRank,
      },
      wallet: {
        balanceUsdMicro: user.referralBalanceUsdMicro,
        pendingUsdMicro: user.referralPendingUsdMicro,
      },
    };
  }

  static async getTransactions(
    userId: string,
    limit = 100,
  ): Promise<ReferralTransactionRow[]> {
    const earnings = await ReferralEarning.find({ referrerId: userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("referredUserId", "name email")
      .lean();

    return earnings.map((e) => {
      const referred = e.referredUserId as unknown as {
        name?: string;
        email?: string;
      } | null;
      return {
        id: String(e._id),
        sourceTransactionId: String(e.sourceTransactionId),
        referredName: displayName(referred),
        planId: e.planId,
        amountUsdMicro: e.amountUsdMicro,
        sigcoinsAwarded: e.sigcoinsAwarded,
        status: e.status,
        createdAt: e.createdAt,
      };
    });
  }

  /** Rank users by lifetime referral earnings (balance + pending). */
  private static async leaderboardAgg(): Promise<
    { _id: mongoose.Types.ObjectId; name?: string; email?: string; total: number }[]
  > {
    return User.aggregate([
      {
        $project: {
          name: 1,
          email: 1,
          total: {
            $add: [
              { $ifNull: ["$referralBalanceUsdMicro", 0] },
              { $ifNull: ["$referralPendingUsdMicro", 0] },
            ],
          },
        },
      },
      { $match: { total: { $gt: 0 } } },
      { $sort: { total: -1, _id: 1 } },
    ]);
  }

  static async getLeaderboard(
    user: IUser,
  ): Promise<{ entries: LeaderboardEntry[]; myRank: number | null }> {
    const ranked = await this.leaderboardAgg();
    const entries: LeaderboardEntry[] = ranked
      .slice(0, LEADERBOARD_SIZE)
      .map((r, i) => ({
        rank: i + 1,
        name: displayName(r),
        totalEarningsUsdMicro: r.total,
        isCurrentUser: String(r._id) === String(user._id),
      }));

    const myIndex = ranked.findIndex(
      (r) => String(r._id) === String(user._id),
    );
    return { entries, myRank: myIndex >= 0 ? myIndex + 1 : null };
  }

  private static async getRank(user: IUser): Promise<number | null> {
    const myTotal =
      user.referralBalanceUsdMicro + user.referralPendingUsdMicro;
    if (myTotal <= 0) return null;
    // Rank = (number of users strictly ahead) + 1.
    const ahead = await User.aggregate([
      {
        $project: {
          total: {
            $add: [
              { $ifNull: ["$referralBalanceUsdMicro", 0] },
              { $ifNull: ["$referralPendingUsdMicro", 0] },
            ],
          },
        },
      },
      { $match: { total: { $gt: myTotal } } },
      { $count: "count" },
    ]);
    return (ahead[0]?.count ?? 0) + 1;
  }
}
