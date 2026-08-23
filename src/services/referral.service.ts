import mongoose from "mongoose";
import User, { IUser } from "../models/user.model";
import ReferralEarning from "../models/referral-earning.model";
import SigcoinLedger from "../models/sigcoin-ledger.model";
import AffiliatePayout from "../models/affiliate-payout.model";
import { ITransaction } from "../models/transaction.model";
import { env } from "../config/env";
import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  SIGCOINS_PER_SUBSCRIBED_REFERRAL,
  SIGCOIN_RATE_USD_DEFAULT,
  earnedUsdMicro,
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
  // SIGcoins earned (subscribed referrals) — the leaderboard ranks by this.
  sigcoins: number;
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
   * No-op in the current model. SIGcoins are only earned when a referral
   * becomes a paying subscriber (see creditReferralForPayment), not on signup.
   * Kept so the once-per-user welcome gate call site stays valid.
   */
  static async creditReferralSignup(_referredUser: IUser): Promise<void> {
    return;
  }

  /**
   * Credit the referrer when a referred user becomes a paying subscriber.
   * Model: 1 subscribed referral = 1 SIGcoin. Awarded at most once per referred
   * user (the first successful payment), guarded by `subscribedReferralCredited`
   * on the referred user. Never throws.
   */
  static async creditReferralForPayment(
    transaction: ITransaction,
  ): Promise<void> {
    await this.creditSubscribedReferral(transaction.userId);
  }

  /**
   * Award a referrer 1 SIGcoin the first time their referral subscribes. Safe
   * to call from any subscription path (crypto checkout). Idempotent per
   * referred user via the `subscribedReferralCredited` flag. Never throws.
   */
  static async creditSubscribedReferral(
    referredUserId: mongoose.Types.ObjectId | string,
  ): Promise<void> {
    try {
      const referredUser = await User.findById(referredUserId);
      if (!referredUser || !referredUser.referredBy) return;
      if (referredUser.subscribedReferralCredited) return; // already counted

      // Atomically claim the credit so concurrent payments can't double-award.
      const claimed = await User.findOneAndUpdate(
        { _id: referredUser._id, subscribedReferralCredited: { $ne: true } },
        { $set: { subscribedReferralCredited: true } },
        { new: true },
      );
      if (!claimed) return; // another call already claimed it

      await this.awardSigcoins(
        referredUser.referredBy as mongoose.Types.ObjectId,
        SIGCOINS_PER_SUBSCRIBED_REFERRAL,
        "referral_subscription",
        referredUser._id as mongoose.Types.ObjectId,
      );
    } catch (err) {
      console.error("creditSubscribedReferral failed", err);
    }
  }

  /** Append a SIGcoin ledger entry and keep the denormalized balance in sync. */
  private static async awardSigcoins(
    userId: mongoose.Types.ObjectId,
    delta: number,
    reason: "referral_subscription",
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

  /** Total USD micro this affiliate has been paid out via recorded payouts. */
  static async paidOutUsdMicro(userId: mongoose.Types.ObjectId | string): Promise<number> {
    const agg = await AffiliatePayout.aggregate([
      { $match: { affiliateId: new mongoose.Types.ObjectId(String(userId)) } },
      { $group: { _id: null, total: { $sum: "$amountUsdMicro" } } },
    ]);
    return agg[0]?.total ?? 0;
  }

  static async getOverview(user: IUser): Promise<ReferralOverview> {
    const code = await this.ensureReferralCode(user);
    const totalReferrals = await User.countDocuments({ referredBy: user._id });
    const leaderboardRank = await this.getRank(user);

    const earned = earnedUsdMicro(user.sigcoins, user.sigcoinRateUsd);
    const paidOut = await this.paidOutUsdMicro(user._id as mongoose.Types.ObjectId);
    const owed = Math.max(0, earned - paidOut);

    return {
      code,
      shareUrl: `${env.FRONTEND_URL.replace(/\/$/, "")}/register?ref=${code}`,
      stats: {
        totalEarningsUsdMicro: earned,
        totalReferrals,
        sigcoins: user.sigcoins,
        leaderboardRank,
      },
      wallet: {
        balanceUsdMicro: owed,
        pendingUsdMicro: 0,
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

  /** Rank affiliates by SIGcoins earned (subscribed referrals). */
  private static async leaderboardAgg(): Promise<
    {
      _id: mongoose.Types.ObjectId;
      name?: string;
      email?: string;
      sigcoins: number;
      rate: number;
    }[]
  > {
    return User.aggregate([
      {
        $project: {
          name: 1,
          email: 1,
          sigcoins: { $ifNull: ["$sigcoins", 0] },
          rate: { $ifNull: ["$sigcoinRateUsd", SIGCOIN_RATE_USD_DEFAULT] },
        },
      },
      { $match: { sigcoins: { $gt: 0 } } },
      { $sort: { sigcoins: -1, _id: 1 } },
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
        sigcoins: r.sigcoins,
        totalEarningsUsdMicro: earnedUsdMicro(r.sigcoins, r.rate),
        isCurrentUser: String(r._id) === String(user._id),
      }));

    const myIndex = ranked.findIndex(
      (r) => String(r._id) === String(user._id),
    );
    return { entries, myRank: myIndex >= 0 ? myIndex + 1 : null };
  }

  private static async getRank(user: IUser): Promise<number | null> {
    const mySigcoins = user.sigcoins ?? 0;
    if (mySigcoins <= 0) return null;
    // Rank = (number of affiliates with strictly more SIGcoins) + 1.
    const ahead = await User.countDocuments({
      sigcoins: { $gt: mySigcoins },
    });
    return ahead + 1;
  }
}
