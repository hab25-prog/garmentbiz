import nodemailer from "nodemailer";

interface VerificationEmail {
  email: string;
  fullName: string;
  token: string;
}

export type VerificationEmailFailureContext = "registration" | "resend";

const SMTP_ENVIRONMENT_NAMES = new Set([
  "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "PUBLIC_FRONTEND_URL",
]);

function safeSmtpCommand(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const command = value.trim().toUpperCase();
  for (const prefix of ["AUTH", "MAIL", "RCPT", "DATA", "STARTTLS", "EHLO", "HELO", "QUIT"]) {
    if (command === prefix || command.startsWith(`${prefix} `)) return prefix;
  }
  return "OTHER";
}

/** Logs only fixed labels and protocol metadata, never an error message, address, token, or SMTP value. */
export function logVerificationEmailFailure(
  error: unknown,
  context: VerificationEmailFailureContext,
): void {
  const details = typeof error === "object" && error !== null
    ? error as { name?: unknown; code?: unknown; responseCode?: unknown; command?: unknown; message?: unknown }
    : {};
  const errorType = typeof details.name === "string" && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(details.name)
    ? details.name
    : "UnknownError";
  const diagnostic: Record<string, string | number> = { context, errorType };

  if (typeof details.code === "string" && /^[A-Z0-9_]{1,32}$/.test(details.code)) {
    diagnostic.code = details.code;
  }
  if (typeof details.responseCode === "number" && Number.isInteger(details.responseCode) && details.responseCode >= 400 && details.responseCode <= 599) {
    diagnostic.responseCode = details.responseCode;
  }
  const command = safeSmtpCommand(details.command);
  if (command) diagnostic.command = command;

  if (typeof details.message === "string") {
    const missingSetting = details.message.match(/^([A-Z_]+) must be configured$/)?.[1];
    if (missingSetting && SMTP_ENVIRONMENT_NAMES.has(missingSetting)) {
      diagnostic.missingSetting = missingSetting;
    } else if (/^(SMTP_PORT|SMTP_SECURE|PUBLIC_FRONTEND_URL) (must be|is invalid|requires)/.test(details.message)) {
      diagnostic.configuration = "invalid_value";
    }
  }
  console.error("Verification email delivery failed", diagnostic);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

function tokenLink(path: "/verify-email" | "/accept-invitation", token: string): string {
  const configuredUrl = requiredEnvironment("PUBLIC_FRONTEND_URL");
  const base = new URL(configuredUrl);
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    throw new Error("PUBLIC_FRONTEND_URL must use HTTP or HTTPS");
  }
  if (process.env.NODE_ENV === "production" && base.protocol !== "https:") {
    throw new Error("PUBLIC_FRONTEND_URL must use HTTPS in production");
  }
  const link = new URL(path, base);
  // The fragment is not sent to the frontend web server. The frontend should POST it in the API body.
  link.hash = new URLSearchParams({ token }).toString();
  return link.toString();
}

function createSmtpTransport() {
  const port = Number(requiredEnvironment("SMTP_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid port");
  }
  const secureValue = requiredEnvironment("SMTP_SECURE").toLowerCase();
  if (secureValue !== "true" && secureValue !== "false") {
    throw new Error("SMTP_SECURE must be true or false");
  }

  return nodemailer.createTransport({
    host: requiredEnvironment("SMTP_HOST"),
    port,
    secure: secureValue === "true",
    auth: {
      user: requiredEnvironment("SMTP_USER"),
      pass: requiredEnvironment("SMTP_PASSWORD"),
    },
  });
}

export function logEmployeeInvitationEmailFailure(
  error: unknown,
  context: "create" | "resend",
): void {
  const details = typeof error === "object" && error !== null
    ? error as { name?: unknown; code?: unknown; responseCode?: unknown; command?: unknown }
    : {};
  const errorType = typeof details.name === "string" && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(details.name)
    ? details.name
    : "UnknownError";
  const diagnostic: Record<string, string | number> = { context, errorType };
  if (typeof details.code === "string" && /^[A-Z0-9_]{1,32}$/.test(details.code)) diagnostic.code = details.code;
  if (typeof details.responseCode === "number" && Number.isInteger(details.responseCode) && details.responseCode >= 400 && details.responseCode <= 599) diagnostic.responseCode = details.responseCode;
  const command = safeSmtpCommand(details.command);
  if (command) diagnostic.command = command;
  console.error("Employee invitation email delivery failed", diagnostic);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

async function sendVerificationEmail({ email, fullName, token }: VerificationEmail): Promise<void> {
  const link = tokenLink("/verify-email", token);
  const transport = createSmtpTransport();
  const safeName = escapeHtml(fullName);
  try {
    await transport.sendMail({
      from: requiredEnvironment("SMTP_FROM"),
      to: email,
      subject: "Verify your GarmentBiz email",
      text: `Hello ${fullName},\n\nVerify your email address within 24 hours by opening this link:\n${link}\n\nIf you did not create a GarmentBiz account, you can ignore this message.`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937"><h1 style="font-size:22px">Verify your email</h1><p>Hello ${safeName},</p><p>Confirm your email address to finish setting up your GarmentBiz account. This link expires in 24 hours.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 18px;background:#155e75;color:#fff;text-decoration:none;border-radius:6px">Verify email address</a></p><p>If the button does not work, open this link:</p><p>${escapeHtml(link)}</p><p>If you did not create a GarmentBiz account, you can ignore this message.</p></div>`,
    });
  } finally {
    transport.close();
  }
}

// Object indirection keeps delivery replaceable in tests without exposing the raw token elsewhere.
export const verificationEmailDelivery = { send: sendVerificationEmail };

interface EmployeeInvitationEmail {
  email: string;
  employeeName: string;
  businessName: string;
  inviterName: string;
  role: string;
  token: string;
}

async function sendEmployeeInvitationEmail({
  email,
  employeeName,
  businessName,
  inviterName,
  role,
  token,
}: EmployeeInvitationEmail): Promise<void> {
  const link = tokenLink("/accept-invitation", token);
  const transport = createSmtpTransport();
  try {
    const result = await transport.sendMail({
      from: requiredEnvironment("SMTP_FROM"),
      to: email,
      subject: `Invitation to join ${businessName} on GarmentBiz`,
      text: `Hello ${employeeName},\n\n${inviterName} invited you to join ${businessName} on GarmentBiz as ${role}. Open this link within 72 hours to accept the invitation:\n${link}\n\nIf you were not expecting this invitation, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937"><h1 style="font-size:22px">You are invited to GarmentBiz</h1><p>Hello ${escapeHtml(employeeName)},</p><p>${escapeHtml(inviterName)} invited you to join <strong>${escapeHtml(businessName)}</strong> as ${escapeHtml(role)}.</p><p>This invitation expires in 72 hours.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 18px;background:#155e75;color:#fff;text-decoration:none;border-radius:6px">Accept invitation</a></p><p>If you were not expecting this invitation, you can ignore this email.</p></div>`,
    });
    if (!result.accepted?.length || result.rejected?.length) {
      throw new Error("SMTP did not accept all invitation recipients");
    }
  } finally {
    transport.close();
  }
}

export const employeeInvitationEmailDelivery = { send: sendEmployeeInvitationEmail };
