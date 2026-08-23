import { PRO_PLAN_PRICE_USD } from "../config/plans";
import User from "../models/user.model";

export const PRO_PLAN_AMOUNT_USD = PRO_PLAN_PRICE_USD;
export const PRO_PLAN_AMOUNT_USD_MICRO = Math.round(PRO_PLAN_AMOUNT_USD * 1_000_000);
export const PRO_PLAN_DURATION_DAYS = 30;

export class SubscriptionService {
  static async activateOrExtendPro(
    userId: string,
    months: number = 1,
  ): Promise<void> {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const safeMonths =
      Number.isFinite(months) && months > 0 ? Math.floor(months) : 1;

    const baseDate =
      user.proPlanExpiry && user.proPlanExpiry.getTime() > Date.now()
        ? new Date(user.proPlanExpiry)
        : new Date();

    baseDate.setDate(
      baseDate.getDate() + PRO_PLAN_DURATION_DAYS * safeMonths,
    );

    user.plan = "pro";
    user.proPlanExpiry = baseDate;
    await user.save();
  }
}
