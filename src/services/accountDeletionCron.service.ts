import cron, { ScheduledTask } from "node-cron";
import { env } from "../config/env";
import { AccountDeletionService } from "./accountDeletion.service";

let task: ScheduledTask | null = null;

export function initializeAccountDeletionCron(): void {
  if (!env.ACCOUNT_DELETION_PURGE_ENABLED) {
    console.warn(
      "⚠️  Account deletion purge is disabled — requested accounts will never be deleted",
    );
    return;
  }
  if (task) return;
  // noOverlap matters here more than anywhere: a slow batch (many collections
  // per account) must not have the next tick start alongside it. The atomic
  // claim in purgeUser already prevents double-purging, but overlapping runs
  // would multiply the write load for no benefit.
  task = cron.schedule(
    env.ACCOUNT_DELETION_PURGE_CRON,
    async () => {
      try {
        await AccountDeletionService.runDuePurges();
      } catch (error) {
        console.error("❌ Account deletion purge cron failed:", error);
      }
    },
    { noOverlap: true },
  );
  console.log(
    `✅ Account deletion purge scheduled: ${env.ACCOUNT_DELETION_PURGE_CRON} (${env.ACCOUNT_DELETION_GRACE_DAYS}-day grace)`,
  );
}

export function stopAccountDeletionCron(): void {
  task?.destroy();
  task = null;
}
