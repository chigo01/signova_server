import mongoose from "mongoose";
import User from "../models/user.model";
import AffiliatePayout from "../models/affiliate-payout.model";
import SigcoinLedger from "../models/sigcoin-ledger.model";
import { AppError } from "../middleware/errorHandler";
import {
  SIGCOIN_RATE_USD_DEFAULT,
  SIGCOIN_RATE_USD_MIN,
  SIGCOIN_RATE_USD_MAX,
  earnedUsdMicro,
  isValidSigcoinRate,
} from "../config/referral";

export interface AdminAffiliateRow {
  id: string;
  name: string;
  email: string;
  plan: string;
  referralCode: string | null;
  totalReferrals: number;
  sigcoins: number;
  sigcoinRateUsd: number;
  earnedUsdMicro: number;
  paidOutUsdMicro: number;
  owedUsdMicro: number;
}

function rowFrom(
  user: {
    _id: mongoose.Types.ObjectId | string;
    name?: string;
    email: string;
    plan?: string;
    referralCode?: string;
    sigcoins?: number;
    sigcoinRateUsd?: number;
  },
  totalReferrals: number,
  paidOutUsdMicro: number,
): AdminAffiliateRow {
  const sigcoins = user.sigcoins ?? 0;
  const rate = user.sigcoinRateUsd ?? SIGCOIN_RATE_USD_DEFAULT;
  const earned = earnedUsdMicro(sigcoins, rate);
  return {
    id: String(user._id),
    name: user.name?.trim() || user.email.split("@")[0],
    email: user.email,
    plan: user.plan ?? "free",
    referralCode: user.referralCode ?? null,
    totalReferrals,
    sigcoins,
    sigcoinRateUsd: rate,
    earnedUsdMicro: earned,
    paidOutUsdMicro,
    owedUsdMicro: Math.max(0, earned - paidOutUsdMicro),
  };
}

export class AdminService {
  /** Paginated affiliate list with computed earnings, optional search. */
  static async listUsers(opts: {
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    users: AdminAffiliateRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 25));

    const filter: Record<string, unknown> = {};
    if (opts.search && opts.search.trim()) {
      const rx = new RegExp(
        opts.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      filter.$or = [{ name: rx }, { email: rx }, { referralCode: rx }];
    }

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .sort({ sigcoins: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select("name email plan referralCode sigcoins sigcoinRateUsd")
      .lean();

    const ids = users.map((u) => u._id as mongoose.Types.ObjectId);

    // Batch-compute referral counts and payouts for this page (avoids N+1).
    const [refCounts, payouts] = await Promise.all([
      User.aggregate([
        { $match: { referredBy: { $in: ids } } },
        { $group: { _id: "$referredBy", count: { $sum: 1 } } },
      ]),
      AffiliatePayout.aggregate([
        { $match: { affiliateId: { $in: ids } } },
        { $group: { _id: "$affiliateId", total: { $sum: "$amountUsdMicro" } } },
      ]),
    ]);

    const refMap = new Map<string, number>(
      refCounts.map((r) => [String(r._id), r.count]),
    );
    const payMap = new Map<string, number>(
      payouts.map((p) => [String(p._id), p.total]),
    );

    return {
      users: users.map((u) =>
        rowFrom(
          u as any,
          refMap.get(String(u._id)) ?? 0,
          payMap.get(String(u._id)) ?? 0,
        ),
      ),
      total,
      page,
      limit,
    };
  }

  /** Full detail for one affiliate: summary + referrals + payouts + ledger. */
  static async getUser(id: string) {
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError(400, "Invalid user id");
    }
    const user = await User.findById(id)
      .select("name email plan referralCode sigcoins sigcoinRateUsd")
      .lean();
    if (!user) throw new AppError(404, "User not found");

    const [totalReferrals, paidOut, referredUsers, payouts, ledger] =
      await Promise.all([
        User.countDocuments({ referredBy: id }),
        AffiliatePayout.aggregate([
          { $match: { affiliateId: new mongoose.Types.ObjectId(id) } },
          { $group: { _id: null, total: { $sum: "$amountUsdMicro" } } },
        ]),
        User.find({ referredBy: id })
          .select("name email plan subscribedReferralCredited createdAt")
          .sort({ createdAt: -1 })
          .lean(),
        AffiliatePayout.find({ affiliateId: id })
          .sort({ createdAt: -1 })
          .lean(),
        SigcoinLedger.find({ userId: id })
          .sort({ createdAt: -1 })
          .limit(50)
          .lean(),
      ]);

    const paidOutUsdMicro = paidOut[0]?.total ?? 0;

    return {
      affiliate: rowFrom(user as any, totalReferrals, paidOutUsdMicro),
      referrals: referredUsers.map((r) => ({
        id: String(r._id),
        name: r.name?.trim() || r.email.split("@")[0],
        email: r.email,
        plan: r.plan ?? "free",
        subscribed: Boolean(r.subscribedReferralCredited),
        createdAt: r.createdAt,
      })),
      payouts: payouts.map((p) => ({
        id: String(p._id),
        amountUsdMicro: p.amountUsdMicro,
        method: p.method,
        reference: p.reference ?? null,
        note: p.note ?? null,
        createdByEmail: p.createdByEmail,
        createdAt: p.createdAt,
      })),
      ledger: ledger.map((l) => ({
        id: String(l._id),
        delta: l.delta,
        reason: l.reason,
        balanceAfter: l.balanceAfter,
        createdAt: l.createdAt,
      })),
    };
  }

  /** Set an affiliate's per-SIGcoin USD rate (must be within [$2, $5]). */
  static async setRate(id: string, rateUsd: unknown): Promise<AdminAffiliateRow> {
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError(400, "Invalid user id");
    }
    if (!isValidSigcoinRate(rateUsd)) {
      throw new AppError(
        400,
        `rateUsd must be a number between ${SIGCOIN_RATE_USD_MIN} and ${SIGCOIN_RATE_USD_MAX}`,
      );
    }
    const user = await User.findByIdAndUpdate(
      id,
      { $set: { sigcoinRateUsd: rateUsd } },
      { new: true },
    )
      .select("name email plan referralCode sigcoins sigcoinRateUsd")
      .lean();
    if (!user) throw new AppError(404, "User not found");

    const [totalReferrals, paidOut] = await Promise.all([
      User.countDocuments({ referredBy: id }),
      AffiliatePayout.aggregate([
        { $match: { affiliateId: new mongoose.Types.ObjectId(id) } },
        { $group: { _id: null, total: { $sum: "$amountUsdMicro" } } },
      ]),
    ]);
    return rowFrom(user as any, totalReferrals, paidOut[0]?.total ?? 0);
  }

  /** Record a manual payout against an affiliate; settles owed balance. */
  static async recordPayout(
    id: string,
    body: { amountUsd?: unknown; method?: unknown; reference?: unknown; note?: unknown },
    adminEmail: string,
  ) {
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError(400, "Invalid user id");
    }
    const user = await User.findById(id).select("_id").lean();
    if (!user) throw new AppError(404, "User not found");

    const amountUsd = Number(body.amountUsd);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      throw new AppError(400, "amountUsd must be a positive number");
    }
    const method =
      typeof body.method === "string" && body.method.trim()
        ? body.method.trim()
        : "manual";

    const amountUsdMicro = Math.round(amountUsd * 1_000_000);
    const payout = await AffiliatePayout.create({
      affiliateId: id,
      amountUsdMicro,
      method,
      reference:
        typeof body.reference === "string" ? body.reference.trim() : undefined,
      note: typeof body.note === "string" ? body.note.trim() : undefined,
      createdByEmail: adminEmail,
    });

    return {
      payout: {
        id: String(payout._id),
        amountUsdMicro: payout.amountUsdMicro,
        method: payout.method,
        reference: payout.reference ?? null,
        note: payout.note ?? null,
        createdByEmail: payout.createdByEmail,
        createdAt: payout.createdAt,
      },
    };
  }

  static async getPayouts(id: string) {
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError(400, "Invalid user id");
    }
    const payouts = await AffiliatePayout.find({ affiliateId: id })
      .sort({ createdAt: -1 })
      .lean();
    return payouts.map((p) => ({
      id: String(p._id),
      amountUsdMicro: p.amountUsdMicro,
      method: p.method,
      reference: p.reference ?? null,
      note: p.note ?? null,
      createdByEmail: p.createdByEmail,
      createdAt: p.createdAt,
    }));
  }

  /** Affiliates ranked by SIGcoins earned (not dollars). */
  static async getLeaderboard(limit = 50) {
    const ranked = await User.aggregate([
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
      { $limit: limit },
    ]);

    return ranked.map((r, i) => ({
      rank: i + 1,
      id: String(r._id),
      name: r.name?.trim() || String(r.email).split("@")[0],
      email: r.email,
      sigcoins: r.sigcoins,
      earnedUsdMicro: earnedUsdMicro(r.sigcoins, r.rate),
    }));
  }

  /** Program-wide totals for the dashboard. */
  static async getStats() {
    const [affiliateAgg, payoutAgg, totalUsers] = await Promise.all([
      User.aggregate([
        { $match: { sigcoins: { $gt: 0 } } },
        {
          $group: {
            _id: null,
            affiliates: { $sum: 1 },
            totalSigcoins: { $sum: "$sigcoins" },
            totalEarnedUsdMicro: {
              $sum: {
                $round: [
                  {
                    $multiply: [
                      "$sigcoins",
                      { $ifNull: ["$sigcoinRateUsd", SIGCOIN_RATE_USD_DEFAULT] },
                      1_000_000,
                    ],
                  },
                  0,
                ],
              },
            },
          },
        },
      ]),
      AffiliatePayout.aggregate([
        { $group: { _id: null, total: { $sum: "$amountUsdMicro" } } },
      ]),
      User.countDocuments({}),
    ]);

    const a = affiliateAgg[0] ?? {
      affiliates: 0,
      totalSigcoins: 0,
      totalEarnedUsdMicro: 0,
    };
    const totalPaidOutUsdMicro = payoutAgg[0]?.total ?? 0;

    return {
      totalUsers,
      affiliates: a.affiliates,
      totalSigcoins: a.totalSigcoins,
      totalEarnedUsdMicro: a.totalEarnedUsdMicro,
      totalPaidOutUsdMicro,
      totalOwedUsdMicro: Math.max(0, a.totalEarnedUsdMicro - totalPaidOutUsdMicro),
    };
  }
}
