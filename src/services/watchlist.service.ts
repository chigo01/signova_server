import mongoose from "mongoose";
import User from "../models/user.model";
import StockNewsDelivery from "../models/stockNewsDelivery.model";
import StockNewsRun from "../models/stockNewsRun.model";
import UserWatchlist, {
  IUserWatchlist,
  WatchlistAlertStatus,
} from "../models/userWatchlist.model";
import { FinnhubService } from "./finnhub.service";
import { isEffectivePro } from "./planEntitlement.service";
import {
  configuredStockNewsAvailability,
  type StockNewsAvailability,
} from "./stockNewsReadiness.service";

export const FREE_WATCHLIST_LIMIT = 3;
export const STOCK_SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

export type StockNewsDeliveryMode = "off" | "immediate" | "daily";

export interface SerializedWatchlistItem {
  symbol: string;
  companyName?: string;
  status: WatchlistAlertStatus;
  alertsActiveSince: string;
  addedAt: string;
}

export interface StockNewsDeliveryHealth {
  availability: StockNewsAvailability;
  lastRunStatus: "completed" | "failed" | null;
  lastRunAt: string | null;
  lastSentAt: string | null;
}

interface LatestStockNewsRun {
  status: "completed" | "failed";
  startedAt: Date;
  completedAt?: Date | null;
}

export function buildStockNewsDeliveryHealth(
  availability: StockNewsAvailability,
  latestRun: LatestStockNewsRun | null,
  latestSent: { sentAt?: Date | null } | null,
): StockNewsDeliveryHealth {
  return {
    availability,
    lastRunStatus: latestRun?.status ?? null,
    lastRunAt: latestRun
      ? (latestRun.completedAt ?? latestRun.startedAt).toISOString()
      : null,
    lastSentAt: latestSent?.sentAt?.toISOString() ?? null,
  };
}

export class WatchlistLimitError extends Error {
  readonly code = "WATCHLIST_LIMIT_REACHED";

  constructor(
    readonly limit: number,
    readonly currentCount: number,
  ) {
    super(`Free accounts can save up to ${limit} stocks`);
  }
}

export function normalizeStockSymbol(value: unknown): string {
  if (typeof value !== "string") throw new Error("symbol must be a string");
  const symbol = value.trim().toUpperCase();
  if (!STOCK_SYMBOL_RE.test(symbol)) throw new Error("Invalid stock symbol");
  return symbol;
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function serialize(entry: IUserWatchlist): SerializedWatchlistItem {
  return {
    symbol: entry.symbol,
    companyName: entry.companyName,
    status: entry.status,
    alertsActiveSince: entry.alertsActiveSince.toISOString(),
    addedAt: entry.addedAt.toISOString(),
  };
}

export class WatchlistService {
  static async reconcileEntitlements(
    userId: string | mongoose.Types.ObjectId,
  ): Promise<{ effectivePlan: "free" | "pro"; entries: IUserWatchlist[] }> {
    const user = await User.findById(userId).select("plan proPlanExpiry");
    if (!user) throw new Error("User not found");

    const entries = await UserWatchlist.find({ userId }).sort({ addedAt: 1 });
    const pro = isEffectivePro(user);
    const now = new Date();

    if (pro) {
      const paused = entries.filter((entry) => entry.status === "plan_paused");
      if (paused.length > 0) {
        await UserWatchlist.updateMany(
          { _id: { $in: paused.map((entry) => entry._id) } },
          { $set: { status: "active", alertsActiveSince: now } },
        );
        for (const entry of paused) {
          entry.status = "active";
          entry.alertsActiveSince = now;
        }
      }
      return { effectivePlan: "pro", entries };
    }

    const active = entries.filter((entry) => entry.status === "active");
    if (active.length > FREE_WATCHLIST_LIMIT) {
      const extras = active.slice(FREE_WATCHLIST_LIMIT);
      await UserWatchlist.updateMany(
        { _id: { $in: extras.map((entry) => entry._id) } },
        { $set: { status: "plan_paused" } },
      );
      for (const entry of extras) entry.status = "plan_paused";
    }

    return { effectivePlan: "free", entries };
  }

  static async getWatchlist(userId: string) {
    const [user, reconciled, latestRun, latestSent] = await Promise.all([
      User.findById(userId).select("stockNewsPreferences"),
      this.reconcileEntitlements(userId),
      StockNewsRun.findOne({ status: { $in: ["completed", "failed"] } })
        .sort({ startedAt: -1 })
        .select("status startedAt completedAt")
        .lean<LatestStockNewsRun | null>(),
      StockNewsDelivery.findOne({ userId, status: "sent" })
        .sort({ sentAt: -1 })
        .select("sentAt")
        .lean<{ sentAt?: Date | null } | null>(),
    ]);
    if (!user) throw new Error("User not found");
    const preferences = user.stockNewsPreferences ?? {
      delivery: "off" as const,
      timezone: "UTC",
      changedAt: user.createdAt ?? new Date(),
    };
    return {
      items: reconciled.entries.map(serialize),
      effectivePlan: reconciled.effectivePlan,
      limit:
        reconciled.effectivePlan === "free" ? FREE_WATCHLIST_LIMIT : null,
      activeCount: reconciled.entries.filter((entry) => entry.status === "active")
        .length,
      preferences: {
        delivery: preferences.delivery,
        timezone: preferences.timezone,
        changedAt: preferences.changedAt.toISOString(),
      },
      deliveryHealth: buildStockNewsDeliveryHealth(
        configuredStockNewsAvailability(),
        latestRun,
        latestSent,
      ),
    };
  }

  static async addStock(
    userId: string,
    input: {
      symbol: unknown;
      delivery?: StockNewsDeliveryMode;
      timezone?: string;
    },
  ) {
    const symbol = normalizeStockSymbol(input.symbol);
    const reconciled = await this.reconcileEntitlements(userId);
    const existing = reconciled.entries.find((entry) => entry.symbol === symbol);
    if (existing) return this.getWatchlist(userId);
    if (
      reconciled.effectivePlan === "free" &&
      reconciled.entries.length >= FREE_WATCHLIST_LIMIT
    ) {
      throw new WatchlistLimitError(
        FREE_WATCHLIST_LIMIT,
        reconciled.entries.length,
      );
    }

    const profile = await FinnhubService.fetchProfile(symbol);
    if (!profile?.name?.trim()) throw new Error("Stock symbol was not found");

    const now = new Date();
    let entry: IUserWatchlist;
    try {
      entry = await UserWatchlist.create({
        userId,
        symbol,
        companyName: profile.name.trim(),
        status: "active",
        alertsActiveSince: now,
        addedAt: now,
      });
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) {
        return this.getWatchlist(userId);
      }
      throw error;
    }

    try {
      if (input.delivery !== undefined || input.timezone !== undefined) {
        await this.updatePreferences(userId, {
          delivery: input.delivery,
          timezone: input.timezone,
        });
      }
    } catch (error) {
      await UserWatchlist.deleteOne({ _id: entry._id });
      throw error;
    }

    return this.getWatchlist(userId);
  }

  static async removeStock(userId: string, rawSymbol: unknown): Promise<void> {
    const symbol = normalizeStockSymbol(rawSymbol);
    await UserWatchlist.deleteOne({ userId, symbol });
  }

  static async setActiveStocks(userId: string, rawSymbols: unknown) {
    if (!Array.isArray(rawSymbols)) throw new Error("symbols must be an array");
    const symbols = [...new Set(rawSymbols.map(normalizeStockSymbol))];
    const reconciled = await this.reconcileEntitlements(userId);
    if (reconciled.effectivePlan === "pro") return this.getWatchlist(userId);
    if (symbols.length > FREE_WATCHLIST_LIMIT) {
      throw new WatchlistLimitError(FREE_WATCHLIST_LIMIT, symbols.length);
    }
    const saved = new Set(reconciled.entries.map((entry) => entry.symbol));
    if (symbols.some((symbol) => !saved.has(symbol))) {
      throw new Error("Active stocks must already be in the watchlist");
    }

    const now = new Date();
    await Promise.all(
      reconciled.entries.map((entry) => {
        const nextStatus: WatchlistAlertStatus = symbols.includes(entry.symbol)
          ? "active"
          : "plan_paused";
        const update: Record<string, unknown> = { status: nextStatus };
        if (nextStatus === "active" && entry.status !== "active") {
          update.alertsActiveSince = now;
        }
        return UserWatchlist.updateOne({ _id: entry._id }, { $set: update });
      }),
    );
    return this.getWatchlist(userId);
  }

  static async updatePreferences(
    userId: string,
    input: { delivery?: unknown; timezone?: unknown },
  ): Promise<void> {
    const updates: Record<string, unknown> = {};
    if (input.delivery !== undefined) {
      if (
        input.delivery !== "off" &&
        input.delivery !== "immediate" &&
        input.delivery !== "daily"
      ) {
        throw new Error("Invalid stock news delivery mode");
      }
      updates["stockNewsPreferences.delivery"] = input.delivery;
    }
    if (input.timezone !== undefined) {
      if (
        typeof input.timezone !== "string" ||
        !isValidTimeZone(input.timezone)
      ) {
        throw new Error("Invalid IANA timezone");
      }
      updates["stockNewsPreferences.timezone"] = input.timezone;
    }
    if (Object.keys(updates).length === 0) return;
    updates["stockNewsPreferences.changedAt"] = new Date();
    const result = await User.updateOne({ _id: userId }, { $set: updates });
    if (result.matchedCount === 0) throw new Error("User not found");
  }
}
