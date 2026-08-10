import { escapeHtml, wrapEmail } from "./_shared";

const SETTINGS_URL = "https://signova.app/dashboard/settings";
const SUPPORT_EMAIL = "support@signova.app";

/**
 * Renders a date the way a member reads one, in UTC so the copy matches the
 * cutoff the purge job actually uses. Example: "12 September 2026".
 */
const formatDeletionDate = (value: Date): string =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);

export interface AccountDeletionRequestedEmailData {
  firstName: string;
  scheduledFor: Date;
  graceDays: number;
}

export const accountDeletionRequestedEmail = (
  data: AccountDeletionRequestedEmailData
): { subject: string; html: string } => {
  const firstName = escapeHtml(data.firstName);
  const scheduledFor = escapeHtml(formatDeletionDate(data.scheduledFor));
  const graceDays = escapeHtml(data.graceDays);

  const html = wrapEmail(`
    <p style="margin:0 0 16px;">Hey ${firstName},</p>

    <p style="margin:0 0 16px;">
      We've received your request to delete your Signova account. Your account and
      everything in it will be permanently deleted on
      <strong>${scheduledFor}</strong>.
    </p>

    <p style="margin:0 0 16px;">
      Nothing has been deleted yet. For the next ${graceDays} days your account
      works exactly as it did before &mdash; your signals, journal, and watchlists
      are all still there.
    </p>

    <p style="margin:0 0 20px;">
      <strong>Changed your mind?</strong> Just log in and choose
      <strong>Keep my account</strong> from the banner or your
      <a href="${SETTINGS_URL}" style="color:#111827;">account settings</a>.
      That cancels the deletion completely, with nothing lost.
    </p>

    <p style="margin:0 0 16px;">
      After ${scheduledFor} this cannot be undone. Your profile, journal entries,
      saved chart layouts, watchlists, and notification settings will be erased.
      We keep a small set of anonymised payment records where we're legally
      required to, with your identity stripped from them.
    </p>

    <p style="margin:0 0 16px;">
      If you didn't request this, contact us at
      <a href="mailto:${SUPPORT_EMAIL}" style="color:#111827;">${SUPPORT_EMAIL}</a>
      straight away.
    </p>

    <p style="margin:0 0 4px;">Sorry to see you go.</p>
    <p style="margin:0;">Signova Team</p>
  `);

  return {
    subject: `Your Signova account is scheduled for deletion on ${formatDeletionDate(
      data.scheduledFor
    )}`,
    html,
  };
};

export interface AccountDeletionCancelledEmailData {
  firstName: string;
}

export const accountDeletionCancelledEmail = (
  data: AccountDeletionCancelledEmailData
): { subject: string; html: string } => {
  const firstName = escapeHtml(data.firstName);

  const html = wrapEmail(`
    <p style="margin:0 0 16px;">Hey ${firstName},</p>

    <p style="margin:0 0 16px;">
      Good news &mdash; the deletion request on your Signova account has been
      cancelled. Your account is fully active and nothing was lost.
    </p>

    <p style="margin:0 0 16px;">
      If you didn't cancel this yourself, let us know at
      <a href="mailto:${SUPPORT_EMAIL}" style="color:#111827;">${SUPPORT_EMAIL}</a>.
    </p>

    <p style="margin:0 0 4px;">Glad to have you back.</p>
    <p style="margin:0;">Signova Team</p>
  `);

  return {
    subject: "Your Signova account deletion has been cancelled",
    html,
  };
};

export interface AccountDeletionCompletedEmailData {
  firstName: string;
}

export const accountDeletionCompletedEmail = (
  data: AccountDeletionCompletedEmailData
): { subject: string; html: string } => {
  const firstName = escapeHtml(data.firstName);

  const html = wrapEmail(`
    <p style="margin:0 0 16px;">Hey ${firstName},</p>

    <p style="margin:0 0 16px;">
      Your Signova account has now been permanently deleted, as you requested.
      Your profile, journal entries, saved chart layouts, watchlists, signal
      history, and notification settings have all been erased, and you will not
      receive any further emails from us.
    </p>

    <p style="margin:0 0 16px;">
      Where we're legally required to retain payment records, we've kept them with
      your identity removed. They can no longer be linked back to you.
    </p>

    <p style="margin:0 0 16px;">
      You're welcome to start fresh any time &mdash; signing up again creates a
      brand new account.
    </p>

    <p style="margin:0 0 4px;">Thanks for trading with us.</p>
    <p style="margin:0;">Signova Team</p>
  `);

  return {
    subject: "Your Signova account has been deleted",
    html,
  };
};
