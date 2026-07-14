export interface PlanEntitlementInput {
  plan?: "free" | "pro";
  proPlanExpiry?: Date | null;
}

export function isEffectivePro(
  user: PlanEntitlementInput,
  now = new Date(),
): boolean {
  return Boolean(
    user.plan === "pro" &&
      user.proPlanExpiry &&
      user.proPlanExpiry.getTime() > now.getTime(),
  );
}

export function effectivePlan(
  user: PlanEntitlementInput,
  now = new Date(),
): "free" | "pro" {
  return isEffectivePro(user, now) ? "pro" : "free";
}
