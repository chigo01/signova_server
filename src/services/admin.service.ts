import mongoose from "mongoose";
import User from "../models/user.model";
import AffiliatePayout from "../models/affiliate-payout.model";
import SigcoinLedger from "../models/sigcoin-ledger.model";
import Transaction from "../models/transaction.model";
import { AppError } from "../middleware/errorHandler";
import { isEffectivePro } from "./planEntitlement.service";
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
  phone?: string;
  username?: string;
  plan: string;
  isPaid: boolean;
  proPlanExpiry?: Date;
  mobileSubscription?: any;
  createdAt: Date;
  lastLoginAt?: Date;
  referralCode: string | null;
  referredBy?: {
    id: string;
    name: string;
    email: string;
  } | null;
  totalReferrals: number;
  paidReferrals: number;
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
    phone?: string;
    username?: string;
    plan?: string;
    proPlanExpiry?: Date;
    mobileSubscription?: any;
    createdAt: Date;
    lastLoginAt?: Date;
    referralCode?: string;
    referredBy?: any;
    sigcoins?: number;
    sigcoinRateUsd?: number;
  },
  totalReferrals: number,
  paidReferrals: number,
  paidOutUsdMicro: number,
  referredByUser?: { _id: any; name?: string; email: string } | null,
): AdminAffiliateRow {
  const sigcoins = user.sigcoins ?? 0;
  const rate = user.sigcoinRateUsd ?? SIGCOIN_RATE_USD_DEFAULT;
  const earned = earnedUsdMicro(sigcoins, rate);
  const isPaid = isEffectivePro({
    plan: user.plan as any,
    proPlanExpiry: user.proPlanExpiry,
    mobileSubscription: user.mobileSubscription,
  });

  return {
    id: String(user._id),
    name: user.name?.trim() || user.email.split("@")[0],
    email: user.email,
    phone: user.phone,
    username: user.username,
    plan: user.plan ?? "free",
    isPaid,
    proPlanExpiry: user.proPlanExpiry,
    mobileSubscription: user.mobileSubscription,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    referralCode: user.referralCode ?? null,
    referredBy: referredByUser
      ? {
          id: String(referredByUser._id),
          name: referredByUser.name?.trim() || referredByUser.email.split("@")[0],
          email: referredByUser.email,
        }
      : null,
    totalReferrals,
    paidReferrals,
    sigcoins,
    sigcoinRateUsd: rate,
    earnedUsdMicro: earned,
    paidOutUsdMicro,
    owedUsdMicro: Math.max(0, earned - paidOutUsdMicro),
  };
}

export class AdminService {
  /** Paginated user/affiliate list with computed earnings, search, filtering, and sorting. */
  static async listUsers(opts: {
    search?: string;
    paidStatus?: string;
    activity?: string;
    hasReferrals?: string;
    sortBy?: string;
    sortDir?: string;
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
    const now = new Date();

    const andConditions: Record<string, unknown>[] = [];

    // Search filter
    if (opts.search && opts.search.trim()) {
      const rx = new RegExp(
        opts.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      andConditions.push({
        $or: [
          { name: rx },
          { email: rx },
          { phone: rx },
          { username: rx },
          { referralCode: rx },
        ],
      });
    }

    // Paid status filter
    if (opts.paidStatus === "paid") {
      andConditions.push({
        $or: [
          { plan: "pro", proPlanExpiry: { $gt: now } },
          { "mobileSubscription.entitlementActive": true },
        ],
      });
    } else if (opts.paidStatus === "free") {
      andConditions.push({
        $and: [
          {
            $or: [
              { plan: { $ne: "pro" } },
              { proPlanExpiry: { $lte: now } },
              { proPlanExpiry: null },
            ],
          },
          {
            $or: [
              { "mobileSubscription.entitlementActive": { $ne: true } },
              { "mobileSubscription.expiresAt": { $lte: now } },
            ],
          },
        ],
      });
    } else if (opts.paidStatus === "expired") {
      andConditions.push({
        plan: "pro",
        proPlanExpiry: { $lte: now },
      });
    }

    // Activity filter
    if (opts.activity === "today") {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      andConditions.push({ lastLoginAt: { $gte: yesterday } });
    } else if (opts.activity === "7d") {
      const past7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      andConditions.push({ lastLoginAt: { $gte: past7d } });
    } else if (opts.activity === "30d") {
      const past30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      andConditions.push({ lastLoginAt: { $gte: past30d } });
    } else if (opts.activity === "never") {
      andConditions.push({
        $or: [{ lastLoginAt: { $exists: false } }, { lastLoginAt: null }],
      });
    }

    // Has referrals filter
    if (opts.hasReferrals === "true") {
      andConditions.push({ sigcoins: { $gt: 0 } });
    } else if (opts.hasReferrals === "false") {
      andConditions.push({
        $or: [{ sigcoins: 0 }, { sigcoins: { $exists: false } }],
      });
    }

    const filter: Record<string, unknown> =
      andConditions.length > 0 ? { $and: andConditions } : {};

    // Sort configuration
    const sortDir: 1 | -1 = opts.sortDir === "asc" ? 1 : -1;
    let sortObj: Record<string, 1 | -1> = { createdAt: -1 };

    switch (opts.sortBy) {
      case "lastLoginAt":
        sortObj = { lastLoginAt: sortDir, createdAt: -1 };
        break;
      case "createdAt":
        sortObj = { createdAt: sortDir };
        break;
      case "sigcoins":
      case "referrals":
        sortObj = { sigcoins: sortDir, createdAt: -1 };
        break;
      case "name":
        sortObj = { name: sortDir };
        break;
      case "email":
        sortObj = { email: sortDir };
        break;
      case "plan":
        sortObj = { plan: sortDir, createdAt: -1 };
        break;
      default:
        sortObj = { sigcoins: -1, createdAt: -1 };
    }

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .sort(sortObj)
      .skip((page - 1) * limit)
      .limit(limit)
      .select(
        "name email phone username plan proPlanExpiry mobileSubscription referralCode sigcoins sigcoinRateUsd createdAt lastLoginAt referredBy",
      )
      .populate("referredBy", "name email")
      .lean();

    const ids = users.map((u) => u._id as mongoose.Types.ObjectId);

    // Batch-compute referral counts, paid referral counts, and payouts for this page (avoids N+1).
    const [refCounts, paidRefCounts, payouts] = await Promise.all([
      User.aggregate([
        { $match: { referredBy: { $in: ids } } },
        { $group: { _id: "$referredBy", count: { $sum: 1 } } },
      ]),
      User.aggregate([
        {
          $match: {
            referredBy: { $in: ids },
            $or: [{ subscribedReferralCredited: true }, { plan: "pro" }],
          },
        },
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
    const paidRefMap = new Map<string, number>(
      paidRefCounts.map((r) => [String(r._id), r.count]),
    );
    const payMap = new Map<string, number>(
      payouts.map((p) => [String(p._id), p.total]),
    );

    return {
      users: users.map((u) =>
        rowFrom(
          u as any,
          refMap.get(String(u._id)) ?? 0,
          paidRefMap.get(String(u._id)) ?? 0,
          payMap.get(String(u._id)) ?? 0,
          (u.referredBy as any) ?? null,
        ),
      ),
      total,
      page,
      limit,
    };
  }

  /** Full detail for one user/affiliate: profile + referrals + payouts + ledger + transactions. */
  static async getUser(id: string) {
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError(400, "Invalid user id");
    }
    const user = await User.findById(id)
      .select(
        "name email phone username plan proPlanExpiry mobileSubscription referralCode sigcoins sigcoinRateUsd createdAt updatedAt lastLoginAt referredBy",
      )
      .populate("referredBy", "name email")
      .lean();
    if (!user) throw new AppError(404, "User not found");

    const [
      totalReferrals,
      paidReferrals,
      paidOut,
      referredUsers,
      payouts,
      ledger,
      transactions,
    ] = await Promise.all([
      User.countDocuments({ referredBy: id }),
      User.countDocuments({
        referredBy: id,
        $or: [{ subscribedReferralCredited: true }, { plan: "pro" }],
      }),
      AffiliatePayout.aggregate([
        { $match: { affiliateId: new mongoose.Types.ObjectId(id) } },
        { $group: { _id: null, total: { $sum: "$amountUsdMicro" } } },
      ]),
      User.find({ referredBy: id })
        .select(
          "name email phone plan proPlanExpiry mobileSubscription subscribedReferralCredited createdAt lastLoginAt",
        )
        .sort({ createdAt: -1 })
        .lean(),
      AffiliatePayout.find({ affiliateId: id })
        .sort({ createdAt: -1 })
        .lean(),
      SigcoinLedger.find({ userId: id })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      Transaction.find({ userId: id })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
    ]);

    const paidOutUsdMicro = paidOut[0]?.total ?? 0;

    return {
      affiliate: rowFrom(
        user as any,
        totalReferrals,
        paidReferrals,
        paidOutUsdMicro,
        (user.referredBy as any) ?? null,
      ),
      referrals: referredUsers.map((r) => ({
        id: String(r._id),
        name: r.name?.trim() || r.email.split("@")[0],
        email: r.email,
        phone: r.phone,
        plan: r.plan ?? "free",
        isPaid: isEffectivePro(r),
        subscribed: Boolean(r.subscribedReferralCredited),
        createdAt: r.createdAt,
        lastLoginAt: r.lastLoginAt ?? null,
      })),
      transactions: transactions.map((t) => ({
        id: String(t._id),
        amount: t.amount,
        planId: t.planId,
        monthsCount: t.monthsCount,
        status: t.status,
        provider: t.provider,
        createdAt: t.createdAt,
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
      .select(
        "name email phone username plan proPlanExpiry mobileSubscription referralCode sigcoins sigcoinRateUsd createdAt lastLoginAt referredBy",
      )
      .populate("referredBy", "name email")
      .lean();
    if (!user) throw new AppError(404, "User not found");

    const [totalReferrals, paidReferrals, paidOut] = await Promise.all([
      User.countDocuments({ referredBy: id }),
      User.countDocuments({
        referredBy: id,
        $or: [{ subscribedReferralCredited: true }, { plan: "pro" }],
      }),
      AffiliatePayout.aggregate([
        { $match: { affiliateId: new mongoose.Types.ObjectId(id) } },
        { $group: { _id: null, total: { $sum: "$amountUsdMicro" } } },
      ]),
    ]);
    return rowFrom(
      user as any,
      totalReferrals,
      paidReferrals,
      paidOut[0]?.total ?? 0,
      (user.referredBy as any) ?? null,
    );
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

  /** Program-wide totals for the affiliate dashboard. */
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

  /** Sales KPI statistics, conversion rates, and recency activity for Sales Admin. */
  static async getSalesStats() {
    const now = new Date();
    const past24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const past7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const past30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      paidUsers,
      active24h,
      active7d,
      active30d,
      totalReferrals,
      recentTransactions,
      recentUsers,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({
        $or: [
          { plan: "pro", proPlanExpiry: { $gt: now } },
          { "mobileSubscription.entitlementActive": true },
        ],
      }),
      User.countDocuments({ lastLoginAt: { $gte: past24h } }),
      User.countDocuments({ lastLoginAt: { $gte: past7d } }),
      User.countDocuments({ lastLoginAt: { $gte: past30d } }),
      User.countDocuments({ referredBy: { $exists: true, $ne: null } }),
      Transaction.find({ status: "success" })
        .sort({ createdAt: -1 })
        .limit(8)
        .populate("userId", "name email")
        .lean(),
      User.find({})
        .sort({ createdAt: -1 })
        .limit(8)
        .select(
          "name email phone plan proPlanExpiry mobileSubscription createdAt lastLoginAt",
        )
        .lean(),
    ]);

    const freeUsers = Math.max(0, totalUsers - paidUsers);
    const conversionRate =
      totalUsers > 0 ? Number(((paidUsers / totalUsers) * 100).toFixed(1)) : 0;

    return {
      totalUsers,
      paidUsers,
      freeUsers,
      conversionRate,
      active24h,
      active7d,
      active30d,
      totalReferrals,
      recentTransactions: recentTransactions.map((t: any) => ({
        id: String(t._id),
        amount: t.amount,
        planId: t.planId,
        provider: t.provider,
        status: t.status,
        user: t.userId
          ? {
              id: String(t.userId._id),
              name: t.userId.name || t.userId.email.split("@")[0],
              email: t.userId.email,
            }
          : null,
        createdAt: t.createdAt,
      })),
      recentUsers: recentUsers.map((u: any) => ({
        id: String(u._id),
        name: u.name?.trim() || u.email.split("@")[0],
        email: u.email,
        phone: u.phone,
        isPaid: isEffectivePro(u, now),
        plan: u.plan ?? "free",
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt ?? null,
      })),
    };
  }
}
