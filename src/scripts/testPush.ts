import "dotenv/config";
import mongoose from "mongoose";
import { env } from "../config/env";
import PushInstallation from "../models/pushInstallation.model";
import User from "../models/user.model";
import { getFirebaseMessaging } from "../services/firebaseAdmin.service";
import { deliverSignalPush } from "../services/pushNotification.service";

function readEmail(argv: string[]): string {
  const emailFlag = argv.find((arg) => arg.startsWith("--email="));
  const email = emailFlag?.slice("--email=".length).trim().toLowerCase();
  if (!email) {
    throw new Error(
      "Usage: pnpm build && pnpm push:test -- --email=user@example.com",
    );
  }
  return email;
}

async function main(): Promise<void> {
  const email = readEmail(process.argv.slice(2));
  if (!env.FIREBASE_PUSH_ENABLED) {
    throw new Error("FIREBASE_PUSH_ENABLED is not true");
  }

  await mongoose.connect(env.MONGO_URI);
  const user = await User.findOne({ email }).select("_id email").lean();
  if (!user) throw new Error(`No user found for ${email}`);

  const installations = await PushInstallation.find({
    userId: user._id,
    registrationType: "fcm_token",
    enabled: true,
  })
    .select("installationId platform lastSeenAt")
    .lean();
  if (installations.length === 0) {
    throw new Error(`No enabled push installations found for ${email}`);
  }

  console.log(
    `[push-test] Targeting ${installations.length} installation(s) for ${email}: ${installations
      .map(
        (installation) =>
          `${installation.platform} lastSeen=${installation.lastSeenAt.toISOString()}`,
      )
      .join(", ")}`,
  );

  const messaging = getFirebaseMessaging();
  if (!messaging) throw new Error("Firebase Messaging is disabled");

  const result = await deliverSignalPush(
    installations.map((installation) => installation.installationId),
    {
      alertType: "NEW_SIGNAL",
      signalId: `server-push-test-${Date.now()}`,
      pair: "TEST/USD",
      direction: "BUY",
    },
    messaging,
  );

  console.log("[push-test] Result:", {
    targeted: result.targeted,
    sent: result.sent,
    failed: result.failed,
    errorCodes: result.errorCodes,
  });
  if (result.failed > 0 || result.sent === 0) process.exitCode = 1;
}

void main()
  .catch((error) => {
    console.error("[push-test] Failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
