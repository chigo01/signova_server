// Referral / affiliate program tunables. Kept as plain constants (same style as
// config/plans.ts) so the economics are easy to find and adjust in one place.

// === SIGcoin economy (current model) ===
// One SIGcoin is earned by a referrer the first time one of their referrals
// becomes a paying subscriber ("1 subscribed referral = 1 SIGcoin"). Each
// affiliate has a personal per-SIGcoin rate (USD) set by an admin within the
// bounds below; their owed earnings are sigcoins * rate (minus payouts).
export const SIGCOIN_RATE_USD_MIN = 2;
export const SIGCOIN_RATE_USD_MAX = 5;
export const SIGCOIN_RATE_USD_DEFAULT = 2;

// SIGcoins earned per unique subscribed referral.
export const SIGCOINS_PER_SUBSCRIBED_REFERRAL = 1;

// === Legacy constants (no longer used by the awarding logic) ===
// Retained for reference / any historical data migrations.
export const REFERRAL_COMMISSION_RATE = 0.2; // 20% (legacy)
export const SIGCOINS_PER_VERIFIED_SIGNUP = 50; // legacy
export const SIGCOINS_PER_PAYMENT = 100; // legacy
export const SIGCOIN_TO_USD_MICRO = 10_000; // legacy ($0.01 fixed)

// Referral code shape: uppercase A–Z0–9, no ambiguous chars (0/O, 1/I) omitted
// for simplicity; collisions are handled by retrying generation.
export const REFERRAL_CODE_LENGTH = 8;
export const REFERRAL_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function sigcoinsToUsdMicro(sigcoins: number): number {
  return Math.round(sigcoins * SIGCOIN_TO_USD_MICRO);
}

/** Whether a per-SIGcoin USD rate is within the allowed [$2, $5] range. */
export function isValidSigcoinRate(rate: unknown): rate is number {
  return (
    typeof rate === "number" &&
    Number.isFinite(rate) &&
    rate >= SIGCOIN_RATE_USD_MIN &&
    rate <= SIGCOIN_RATE_USD_MAX
  );
}

/** Owed earnings in USD micro-units for a given sigcoin count and rate. */
export function earnedUsdMicro(sigcoins: number, rateUsd: number): number {
  return Math.round(sigcoins * rateUsd * 1_000_000);
}
