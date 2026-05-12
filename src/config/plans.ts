export type PlanId = "pro" | "business";

export interface PlanConfig {
  priceNgn: number;
  months: number;
  displayUsd: number;
}

export const PLANS: Record<PlanId, PlanConfig> = {
  pro: { priceNgn: 100, months: 1, displayUsd: 100 },
  business: { priceNgn: 200, months: 2, displayUsd: 200 },
};

export function isPlanId(value: unknown): value is PlanId {
  return value === "pro" || value === "business";
}
