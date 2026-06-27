import mongoose, { Document, Schema } from "mongoose";

// Revoked JWTs. A token lands here on logout and is rejected by auth middleware
// until its natural expiry, at which point the TTL index removes the row (the
// token is then invalid on its own). Mirrors admin-server's TokenBlacklist so
// signova_server finally has a server-side kill switch for issued tokens
// (audit H4).
export interface ITokenBlacklist extends Document {
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

const TokenBlacklistSchema: Schema = new Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 }, // TTL index — auto-delete once the token has expired
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model<ITokenBlacklist>(
  "TokenBlacklist",
  TokenBlacklistSchema
);
