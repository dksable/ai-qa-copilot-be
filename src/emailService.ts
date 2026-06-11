interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

const resendApiUrl = "https://api.resend.com/emails";

export function appUrl() {
  return (process.env.FRONTEND_APP_URL || process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
}

export function absoluteAppLink(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${appUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY || process.env.SENDER_API_KEY);
}

export async function sendEmail({ to, subject, html, text }: SendEmailInput) {
  const apiKey = process.env.RESEND_API_KEY || process.env.SENDER_API_KEY;
  if (!apiKey) return { sent: false, skipped: true };

  const response = await fetch(resendApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "AI QA Copilot <onboarding@resend.dev>",
      to,
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message || "Email provider failed to send message.");
  }

  return { sent: true, skipped: false };
}

export async function sendPasswordResetEmail(to: string, resetLink: string) {
  const link = absoluteAppLink(resetLink);
  return sendEmail({
    to,
    subject: "Reset your AI QA Copilot password",
    text: `Reset your AI QA Copilot password: ${link}`,
    html: `
      <div style="font-family: Inter, Arial, sans-serif; line-height: 1.6; color: #0f172a;">
        <h2>Reset your AI QA Copilot password</h2>
        <p>Use the link below to reset your password. This link expires shortly.</p>
        <p><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;">Reset Password</a></p>
        <p style="font-size:12px;color:#64748b;">If you did not request this, you can ignore this email.</p>
      </div>
    `,
  });
}

export async function sendWorkspaceInviteEmail(input: {
  to: string;
  workspaceName: string;
  role: string;
  inviteLink: string;
  message?: string;
}) {
  const link = absoluteAppLink(input.inviteLink);
  return sendEmail({
    to: input.to,
    subject: `You're invited to ${input.workspaceName} on AI QA Copilot`,
    text: `You were invited to ${input.workspaceName} as ${input.role}. Join here: ${link}`,
    html: `
      <div style="font-family: Inter, Arial, sans-serif; line-height: 1.6; color: #0f172a;">
        <h2>You're invited to ${input.workspaceName}</h2>
        <p>You have been invited to join AI QA Copilot as <strong>${input.role}</strong>.</p>
        ${input.message ? `<p>${input.message}</p>` : ""}
        <p><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;">Accept Invite</a></p>
        <p style="font-size:12px;color:#64748b;">If the button does not work, copy this link: ${link}</p>
      </div>
    `,
  });
}
