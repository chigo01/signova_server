export interface PlanEntitlementInput {
  plan?: "free" | "pro";
  proPlanExpiry?: Date | null;
  mobileSubscription?: {
    entitlementActive?: boolean;
    expiresAt?: Date | null;
  } | null;
}

export function isEffectivePro(
  user: PlanEntitlementInput,
  now = new Date(),
): boolean {
  const webPro = Boolean(
    user.plan === "pro" &&
      user.proPlanExpiry &&
      user.proPlanExpiry.getTime() > now.getTime(),
  );
  const mobile = user.mobileSubscription;
  const mobilePro = Boolean(
    mobile?.entitlementActive &&
      (!mobile.expiresAt || mobile.expiresAt.getTime() > now.getTime()),
  );
  return webPro || mobilePro;
}

/** Latest finite access expiry across web and native stores. Undefined means lifetime. */
export function effectiveProExpiry(
  user: PlanEntitlementInput,
  now = new Date(),
): Date | undefined {
  const mobile = user.mobileSubscription;
  if (mobile?.entitlementActive && !mobile.expiresAt) return undefined;

  const expiries = [
    user.plan === "pro" ? user.proPlanExpiry : undefined,
    mobile?.entitlementActive ? mobile.expiresAt : undefined,
  ].filter(
    (value): value is Date =>
      value instanceof Date && value.getTime() > now.getTime(),
  );
  if (expiries.length === 0) return undefined;
  return new Date(Math.max(...expiries.map((value) => value.getTime())));
}

export function effectivePlan(
  user: PlanEntitlementInput,
  now = new Date(),
): "free" | "pro" {
  return isEffectivePro(user, now) ? "pro" : "free";
}
