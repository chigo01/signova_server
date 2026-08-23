export type PlanId = "pro";
/** Kept so historical transactions and referral rows still type-check. */
export type HistoricalPlanId = "pro" | "business";

export interface PlanConfig {
  months: number;
  displayUsd: number;
  /** Bachs NGN floor is 100. Used for bank transfer and NGN cards. */
  displayNgn: number;
}

/** Bachs live USD minimum. Restore to 39.99 after live testing. */
export const PRO_PLAN_PRICE_USD = 1;
/** Bachs live NGN minimum. Restore with the USD price after live testing. */
export const PRO_PLAN_PRICE_NGN = 100;

export const PLANS: Record<PlanId, PlanConfig> = {
  pro: {
    months: 1,
    displayUsd: PRO_PLAN_PRICE_USD,
    displayNgn: PRO_PLAN_PRICE_NGN,
  },
};

export function planNgnAmount(plan: PlanConfig): string {
  return plan.displayNgn.toFixed(2);
}

export function isPlanId(value: unknown): value is PlanId {
  return value === "pro";
}
