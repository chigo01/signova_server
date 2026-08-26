import cron, { ScheduledTask } from "node-cron";
import {
  sendWebinarReminders,
  WEBINAR_START_AT,
} from "./webinar.service";

let task: ScheduledTask | null = null;

export function initializeWebinarReminderCron(): void {
  if (task) return;
  if (Date.now() >= WEBINAR_START_AT.getTime()) {
    console.log("ℹ️ Webinar reminder cron skipped — the session has already started");
    return;
  }

  task = cron.schedule(
    "* * * * *",
    async () => {
      try {
        const result = await sendWebinarReminders();
        if (result.due && (result.sent > 0 || result.failed > 0)) {
          console.log(
            `✅ Webinar reminders sent=${result.sent} failed=${result.failed}`
          );
        }
        if (Date.now() >= WEBINAR_START_AT.getTime()) {
          stopWebinarReminderCron();
        }
      } catch (error) {
        console.error("❌ Webinar reminder cron failed:", error);
      }
    },
    { noOverlap: true, timezone: "UTC" }
  );
  console.log(
    "✅ Webinar reminder scheduled: 30 minutes before Saturday 12:00 PM WAT"
  );
}

export function stopWebinarReminderCron(): void {
  task?.destroy();
  task = null;
}
