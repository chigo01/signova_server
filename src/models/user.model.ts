import mongoose, { Document, Schema } from "mongoose";

export interface IUser extends Document {
  email: string;
  name?: string;
  otp?: string;
  otpExpiry?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema(
  {
    email: { type: String, required: true, unique: true },
    name: { type: String },
    otp: { type: String },
    otpExpiry: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model<IUser>("User", UserSchema);
