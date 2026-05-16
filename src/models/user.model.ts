import mongoose, { Document, Schema } from "mongoose";

export interface IUser extends Document {
  email: string;
  name?: string;
  username?: string;
  role?: string;
  avatarDataUrl?: string;
  tradeReversalEnabled: boolean;
  googleId?: string;
  otp?: string;
  otpExpiry?: Date;
  plan: 'free' | 'pro';
  proPlanExpiry?: Date;
  balanceUsdMicro: number;
  welcomedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema(
  {
    email: { type: String, required: true, unique: true },
    name: { type: String },
    username: {
      type: String,
      lowercase: true,
      trim: true,
      index: { unique: true, sparse: true },
    },
    role: { type: String, maxlength: 60 },
    avatarDataUrl: { type: String },
    tradeReversalEnabled: { type: Boolean, default: true },
    googleId: { type: String, sparse: true },
    otp: { type: String },
    otpExpiry: { type: Date },
    plan: { type: String, enum: ['free', 'pro'], default: 'free' },
    proPlanExpiry: { type: Date },
    balanceUsdMicro: { type: Number, default: 0 },
    welcomedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model<IUser>("User", UserSchema);
