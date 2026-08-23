export type PlanId = "pro";
/** Kept so historical transactions and referral rows still type-check. */
export type HistoricalPlanId = "pro" | "business";

export interface PlanConfig {
  months: number;
  displayUsd: number;
}

export const PRO_PLAN_PRICE_USD = 39.99;

export const PLANS: Record<PlanId, PlanConfig> = {
  pro: {
    months: 1,
    displayUsd: PRO_PLAN_PRICE_USD,
  },
};

export function isPlanId(value: unknown): value is PlanId {
  return value === "pro";
}
