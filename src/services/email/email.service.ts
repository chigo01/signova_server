import { Resend } from "resend";
import { env } from "../../config/env";
import { FROM_EMAIL } from "./templates/_shared";

const resend = new Resend(env.RESEND_API_KEY);

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}

// Throws when Resend rejects the send (rate limit, bad address, domain issue)
// so callers can count real failures — silently swallowing here made the
// signal-alert webhook report sent=42 even if every send had failed. Callers
// that intentionally fire-and-forget (welcome email, blast script) already
// wrap their calls in try/catch.
export async function sendEmail({
  to,
  subject,
  html,
  from = FROM_EMAIL,
  replyTo,
}: SendEmailParams): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[DEV ONLY] Email to ${to} skipped (no RESEND_API_KEY): ${subject}`);
    return;
  }

  const { error } = await resend.emails.send({
    from,
    to,
    subject,
    html,
    ...(replyTo ? { replyTo } : {}),
  });
  if (error) {
    console.error("Resend Error:", error);
    throw new Error(`Resend send failed: ${error.message ?? String(error)}`);
  }
}
