import mongoose, { Document, Schema } from "mongoose";
import { SIGCOIN_RATE_USD_DEFAULT } from "../config/referral";

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
  googleId?: string;
  otp?: string;
  otpExpiry?: Date;
  plan: 'free' | 'pro';
  proPlanExpiry?: Date;
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
    googleId: { type: String, sparse: true },
    otp: { type: String },
    otpExpiry: { type: Date },
    plan: { type: String, enum: ['free', 'pro'], default: 'free' },
    proPlanExpiry: { type: Date },
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
  },
  { timestamps: true }
);

export default mongoose.model<IUser>("User", UserSchema);
