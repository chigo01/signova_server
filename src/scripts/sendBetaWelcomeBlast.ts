import "dotenv/config";
import mongoose from "mongoose";
import pLimit from "p-limit";
import { env } from "../config/env";
import User from "../models/user.model";
import { sendEmail } from "../services/email/email.service";
import { welcomeEmail } from "../services/email/templates/welcome";
import { deriveFirstName } from "../services/email/templates/_shared";

interface Args {
  send: boolean;
  force: boolean;
  limit: number | null;
  concurrency: number;
  emails: string[] | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    send: false,
    force: false,
    limit: null,
    concurrency: 5,
    emails: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--send") args.send = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--limit") {
      const next = Number(argv[++i]);
      if (Number.isFinite(next) && next > 0) args.limit = Math.floor(next);
    } else if (arg === "--concurrency") {
      const next = Number(argv[++i]);
      if (Number.isFinite(next) && next > 0) args.concurrency = Math.floor(next);
    } else if (arg === "--emails") {
      const raw = argv[++i] || "";
      const list = raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0);
      if (list.length > 0) args.emails = list;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!env.RESEND_API_KEY) {
    console.error("❌ RESEND_API_KEY is not set. Aborting.");
    process.exit(1);
  }

  console.log(
    `Mode: ${args.send ? "SEND" : "DRY-RUN"} | force=${args.force} | limit=${args.limit ?? "all"} | concurrency=${args.concurrency}${args.emails ? ` | targeted=${args.emails.length}` : ""}`
  );

  await mongoose.connect(env.MONGO_URI);
  console.log("✅ Connected to MongoDB");

  type LeanUser = {
    _id: unknown;
    email: string;
    name?: string;
    welcomedAt?: Date | null;
  };
  let users: LeanUser[] = [];

  if (args.emails) {
    const targetRegexes = args.emails.map(
      (e) => new RegExp(`^${e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
    );
    const found = await User.find({ email: { $in: targetRegexes } })
      .select("email name welcomedAt")
      .lean();

    const foundByEmail = new Map<string, LeanUser>();
    for (const u of found) {
      const key = u.email.trim().toLowerCase();
      if (!foundByEmail.has(key)) foundByEmail.set(key, u as LeanUser);
    }
    users = args.emails.map<LeanUser>((email) => {
      const existing = foundByEmail.get(email);
      return (
        existing || {
          _id: null,
          email,
          name: undefined,
          welcomedAt: null,
        }
      );
    });
    console.log(`Targeted ${args.emails.length} email(s); ${foundByEmail.size} found in DB.`);
  } else {
    const filter: Record<string, unknown> = {
      email: { $exists: true, $type: "string", $ne: "" },
    };
    if (!args.force) {
      filter.$or = [{ welcomedAt: null }, { welcomedAt: { $exists: false } }];
    }

    const totalMatching = await User.countDocuments(filter);
    console.log(`Matching users: ${totalMatching}`);

    const query = User.find(filter).select("email name welcomedAt");
    if (args.limit) query.limit(args.limit);
    users = (await query.lean()) as LeanUser[];
  }

  console.log(`Loading ${users.length} user(s) for processing.`);

  if (!args.send) {
    const preview = users.slice(0, 5).map((u) => ({
      email: u.email,
      name: u.name,
      welcomedAt: u.welcomedAt || null,
    }));
    console.log("Preview (first 5):");
    console.log(JSON.stringify(preview, null, 2));
    console.log("\nDry-run complete. Re-run with --send to actually email these users.");
    await mongoose.disconnect();
    return;
  }

  const limit = pLimit(args.concurrency);
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  await Promise.all(
    users.map((user) =>
      limit(async () => {
        const email = user.email?.trim().toLowerCase();
        if (!email) {
          skipped++;
          return;
        }

        try {
          const { subject, html } = welcomeEmail({
            firstName: deriveFirstName(user.name),
          });
          await sendEmail({ to: email, subject, html });

          if (user._id) {
            await User.updateOne(
              { _id: user._id },
              { $set: { welcomedAt: new Date() } }
            );
          }

          sent++;
          if (sent % 25 === 0) {
            console.log(`...sent ${sent}/${users.length}`);
          }
        } catch (err) {
          failed++;
          console.error(`✗ Failed to send to ${email}:`, err);
        }
      })
    )
  );

  console.log(
    `\nDone. sent=${sent} failed=${failed} skipped=${skipped} total=${users.length}`
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Script crashed:", err);
  process.exit(1);
});
