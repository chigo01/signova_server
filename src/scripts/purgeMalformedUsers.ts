import "dotenv/config";
import mongoose from "mongoose";
import { env } from "../config/env";
import { PROFILE_CONSTANTS } from "../config/constants";
import User from "../models/user.model";

/**
 * One-off cleanup: permanently delete user records that are BOTH
 *   (1) malformed — email fails PROFILE_CONSTANTS.EMAIL_REGEX, AND
 *   (2) unverified — welcomedAt is null or missing (never completed a verified login).
 *
 * A malformed address can never receive an OTP, so it can never have verified
 * or accrued any JWT-gated data (journals/transactions/deposits all require a
 * verified session). The welcomedAt guard is a safety belt on top of that.
 *
 * Deletes immediately on run, printing an audit log of every removed record.
 * Run: npx ts-node -r tsconfig-paths/register src/scripts/purgeMalformedUsers.ts
 */
async function main() {
  await mongoose.connect(env.MONGO_URI);
  console.log("✅ Connected to MongoDB");

  type LeanUser = {
    _id: mongoose.Types.ObjectId;
    email?: string;
    welcomedAt?: Date | null;
    createdAt?: Date;
  };

  // Collection is tiny — fetch all and filter in JS (Mongo can't easily express
  // "email does NOT match this regex").
  const all = (await User.find({})
    .select("email welcomedAt createdAt")
    .lean()) as LeanUser[];

  const targets = all.filter((u) => {
    const email = (u.email ?? "").trim();
    const malformed = !PROFILE_CONSTANTS.EMAIL_REGEX.test(email);
    const unverified = u.welcomedAt == null;
    return malformed && unverified;
  });

  console.log(
    `Scanned ${all.length} user(s); ${targets.length} match malformed + unverified.`
  );

  if (targets.length === 0) {
    console.log("Nothing to delete.");
    await mongoose.disconnect();
    return;
  }

  console.log("\n--- Records to delete (audit log) ---");
  for (const u of targets) {
    console.log(
      `  ${JSON.stringify(u.email)}  _id=${String(u._id)}  createdAt=${
        u.createdAt ? new Date(u.createdAt).toISOString() : "n/a"
      }`
    );
  }
  console.log("-------------------------------------\n");

  const ids = targets.map((u) => u._id);
  const result = await User.deleteMany({ _id: { $in: ids } });
  console.log(`✅ Deleted ${result.deletedCount} record(s).`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Script crashed:", err);
  process.exit(1);
});
