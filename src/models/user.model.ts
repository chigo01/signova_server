import mongoose, { Document, Schema } from "mongoose";
import { SIGCOIN_RATE_USD_DEFAULT } from "../config/referral";
import { ACCOUNT_DELETION_CONSTANTS } from "../config/constants";

export interface IUser extends Document {
  email: string;
  name?: string;
  phone?: string;
  username?: string;
  role?: string;
  avatarDataUrl?: string;
  tradeReversalEnabled: boolean;
  notificationPreferences?: {
    newSignals: boolean;
    tradeAlerts: boolean;
    newsletter: boolean;
  };
  stockNewsPreferences?: {
    delivery: "off" | "immediate" | "daily";
    timezone: string;
    changedAt: Date;
  };
  googleId?: string;
  appleId?: string;
  appleRefreshTokenEncrypted?: string;
  otp?: string;
  otpExpiry?: Date;
  plan: 'free' | 'pro';
  proPlanExpiry?: Date;
  mobileSubscription?: {
    provider: "revenuecat";
    entitlementId: string;
    entitlementActive: boolean;
    productId?: string;
    store?: string;
    environment?: "SANDBOX" | "PRODUCTION";
    status: "active" | "cancelled" | "billing_issue" | "expired";
    expiresAt?: Date;
    willRenew: boolean;
    originalTransactionId?: string;
    lastEventTimestampMs?: number;
    syncedAt: Date;
  };
  balanceUsdMicro: number;
  // Referral / affiliate program. `balanceUsdMicro` above is the Dextopus
  // funding wallet and is intentionally kept separate from these earnings.
  referralCode?: string;
  referredBy?: mongoose.Types.ObjectId;
  referralBalanceUsdMicro: number;
  referralPendingUsdMicro: number;
  // Count of this user's referrals who have become paying subscribers. In the
  // current model, 1 subscribed referral = 1 SIGcoin (see referral.service.ts).
  sigcoins: number;
  // Admin-controlled USD rate paid per SIGcoin for this affiliate ($2–$5).
  sigcoinRateUsd: number;
  // Idempotency flag (set on the *referred* user) so their referrer is credited
  // at most one SIGcoin — the first time this user pays for a subscription.
  subscribedReferralCredited?: boolean;
  welcomedAt?: Date | null;
  // Account deletion (Google Play / App Store 5.1.1(v)). The account stays
  // fully usable during the grace window; only the purge job destroys data.
  deletionRequestedAt?: Date;
  /** requestedAt + ACCOUNT_DELETION_GRACE_DAYS. Absent means no pending request. */
  deletionScheduledFor?: Date;
  /** Free-text, retained for product insight only. Never returned to clients. */
  deletionReason?: string;
  deletionRequestedFrom?: "web" | "ios" | "android" | "unknown";
  /** Set when the purge job claims this account; blocks a racing revocation. */
  deletionPurgeStartedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema(
  {
    email: { type: String, required: true, unique: true },
    name: { type: String },
    phone: { type: String },
    username: {
      type: String,
      lowercase: true,
      trim: true,
      index: { unique: true, sparse: true },
    },
    role: { type: String, maxlength: 60 },
    avatarDataUrl: { type: String },
    tradeReversalEnabled: { type: Boolean, default: true },
    notificationPreferences: {
      newSignals: { type: Boolean, default: true },
      tradeAlerts: { type: Boolean, default: true },
      newsletter: { type: Boolean, default: true },
    },
    stockNewsPreferences: {
      delivery: {
        type: String,
        enum: ["off", "immediate", "daily"],
        default: "off",
      },
      timezone: { type: String, default: "UTC" },
      changedAt: { type: Date, default: Date.now },
    },
    googleId: { type: String, sparse: true },
    appleId: {
      type: String,
      index: { unique: true, sparse: true },
    },
    appleRefreshTokenEncrypted: {
      type: String,
      select: false,
    },
    otp: { type: String },
    otpExpiry: { type: Date },
    plan: { type: String, enum: ['free', 'pro'], default: 'free' },
    proPlanExpiry: { type: Date },
    mobileSubscription: {
      provider: { type: String, enum: ["revenuecat"] },
      entitlementId: { type: String },
      entitlementActive: { type: Boolean, default: false },
      productId: { type: String },
      store: { type: String },
      environment: { type: String, enum: ["SANDBOX", "PRODUCTION"] },
      status: {
        type: String,
        enum: ["active", "cancelled", "billing_issue", "expired"],
      },
      expiresAt: { type: Date },
      willRenew: { type: Boolean, default: false },
      originalTransactionId: { type: String },
      lastEventTimestampMs: { type: Number },
      syncedAt: { type: Date },
    },
    balanceUsdMicro: { type: Number, default: 0 },
    referralCode: {
      type: String,
      uppercase: true,
      trim: true,
      index: { unique: true, sparse: true },
    },
    referredBy: { type: Schema.Types.ObjectId, ref: "User", index: true },
    referralBalanceUsdMicro: { type: Number, default: 0 },
    referralPendingUsdMicro: { type: Number, default: 0 },
    sigcoins: { type: Number, default: 0 },
    sigcoinRateUsd: { type: Number, default: SIGCOIN_RATE_USD_DEFAULT },
    subscribedReferralCredited: { type: Boolean, default: false },
    welcomedAt: { type: Date, default: null },
    deletionRequestedAt: { type: Date },
    deletionScheduledFor: { type: Date },
    deletionReason: {
      type: String,
      maxlength: ACCOUNT_DELETION_CONSTANTS.REASON_MAX,
    },
    deletionRequestedFrom: {
      type: String,
      enum: ACCOUNT_DELETION_CONSTANTS.PLATFORMS,
    },
    deletionPurgeStartedAt: { type: Date },
  },
  { timestamps: true }
);

// Drives the purge job's due query. Sparse because the overwhelming majority of
// users never request deletion.
UserSchema.index({ deletionScheduledFor: 1 }, { sparse: true });

export default mongoose.model<IUser>("User", UserSchema);
