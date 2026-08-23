import { PRO_PLAN_PRICE_USD } from "../config/plans";
import User from "../models/user.model";

export const PRO_PLAN_AMOUNT_USD = PRO_PLAN_PRICE_USD;
export const PRO_PLAN_AMOUNT_USD_MICRO = Math.round(PRO_PLAN_AMOUNT_USD * 1_000_000);
export const PRO_PLAN_DURATION_DAYS = 30;

/** One prepaid month is 30 UTC days. Existing unused time is kept. */
export function nextProExpiry(
  now: Date,
  existingExpiry?: Date | null,
  months: number = 1,
): Date {
  const safeMonths =
    Number.isFinite(months) && months > 0 ? Math.floor(months) : 1;
  const base =
    existingExpiry && existingExpiry.getTime() > now.getTime()
      ? new Date(existingExpiry.getTime())
      : new Date(now.getTime());
  base.setUTCDate(base.getUTCDate() + PRO_PLAN_DURATION_DAYS * safeMonths);
  return base;
}

export class SubscriptionService {
  static async activateOrExtendPro(
    userId: string,
    months: number = 1,
  ): Promise<void> {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    user.plan = "pro";
    user.proPlanExpiry = nextProExpiry(new Date(), user.proPlanExpiry, months);
    await user.save();
  }
}
