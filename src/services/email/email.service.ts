import { Resend } from "resend";
import { env } from "../../config/env";
import { FROM_EMAIL } from "./templates/_shared";

const resend = new Resend(env.RESEND_API_KEY);

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export async function sendEmail({
  to,
  subject,
  html,
  from = FROM_EMAIL,
}: SendEmailParams): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[DEV ONLY] Email to ${to} skipped (no RESEND_API_KEY): ${subject}`);
    return;
  }

  try {
    const { error } = await resend.emails.send({ from, to, subject, html });
    if (error) {
      console.error("Resend Error:", error);
    }
  } catch (emailError) {
    console.error("Resend Error:", emailError);
  }
}
