// Referral / affiliate program tunables. Kept as plain constants (same style as
// config/plans.ts) so the economics are easy to find and adjust in one place.

// Share of each successful subscription payment paid to the referrer.
// Base is the plan's USD price (PLANS[planId].displayUsd).
export const REFERRAL_COMMISSION_RATE = 0.2; // 20%

// SIGcoins awarded to the referrer the first time a referred user verifies.
export const SIGCOINS_PER_VERIFIED_SIGNUP = 50;

// SIGcoins awarded to the referrer on each paid subscription cycle.
export const SIGCOINS_PER_PAYMENT = 100;

// Conversion rule for the SIGcoin economy: how much one SIGcoin is worth in
// USD micro-units (1 USD = 1_000_000 micro). 10_000 => 1 SIGcoin = $0.01.
export const SIGCOIN_TO_USD_MICRO = 10_000;

// Referral code shape: uppercase A–Z0–9, no ambiguous chars (0/O, 1/I) omitted
// for simplicity; collisions are handled by retrying generation.
export const REFERRAL_CODE_LENGTH = 8;
export const REFERRAL_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function sigcoinsToUsdMicro(sigcoins: number): number {
  return Math.round(sigcoins * SIGCOIN_TO_USD_MICRO);
}
