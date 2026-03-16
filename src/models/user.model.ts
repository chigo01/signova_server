import mongoose, { Document, Schema } from "mongoose";

export interface IUser extends Document {
  email: string;
  name?: string;
  googleId?: string;
  otp?: string;
  otpExpiry?: Date;
  plan: 'free' | 'pro';
  proPlanExpiry?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema(
  {
    email: { type: String, required: true, unique: true },
    name: { type: String },
    googleId: { type: String, sparse: true },
    otp: { type: String },
    otpExpiry: { type: Date },
    plan: { type: String, enum: ['free', 'pro'], default: 'free' },
    proPlanExpiry: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model<IUser>("User", UserSchema);
