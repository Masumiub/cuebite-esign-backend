import nodemailer, { type Transporter } from "nodemailer"

export type SmtpRuntimeConfig = {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  fromName: string | null
  fromEmail: string
}

export type EmailTarget = {
  name: string
  email: string
  link: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function fromHeader(c: SmtpRuntimeConfig): string {
  const address = c.fromEmail || c.user
  return c.fromName ? `"${c.fromName}" <${address}>` : address
}

function makeTransport(c: SmtpRuntimeConfig): Transporter {
  // `family: 4` forces IPv4 at the socket layer. Render's free tier has no
  // outbound IPv6, and `dns.setDefaultResultOrder("ipv4first")` alone is not
  // sufficient — TLS connect still picks the IPv6 address and fails with
  // ENETUNREACH. Nodemailer passes `family` through to `net.connect` at
  // runtime, but it's not in the public TS types, hence the cast.
  const opts = {
    host: c.host,
    port: c.port || 465,
    secure: !!c.secure,
    auth: { user: c.user, pass: c.password },
    family: 4,
  } as Parameters<typeof nodemailer.createTransport>[0]
  return nodemailer.createTransport(opts)
}

function renderSigningHtml({
  recipientName,
  senderName,
  subject,
  message,
  link,
}: {
  recipientName: string
  senderName: string
  subject: string
  message: string
  link: string
}) {
  const safeSubject = escapeHtml(subject)
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br/>")
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid #e5e7eb;padding:28px;">
        <tr><td>
          <div style="display:inline-flex;align-items:center;gap:8px;color:#1e3a8a;font-weight:600;font-size:14px;">
            <span style="display:inline-block;width:24px;height:24px;border-radius:6px;background:linear-gradient(135deg,#3b82f6,#1e3a8a);"></span>
            Cuebites eSign
          </div>
          <h1 style="font-size:20px;line-height:1.4;color:#0a0a0a;margin:18px 0 6px;">Hi ${escapeHtml(recipientName)},</h1>
          <p style="font-size:14px;color:#525252;margin:0 0 18px;">
            <strong style="color:#0a0a0a;">${escapeHtml(senderName)}</strong> has sent you "<strong>${safeSubject}</strong>" to review and sign.
          </p>
          ${message ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;font-size:13px;color:#334155;margin:0 0 22px;">${safeMessage}</div>` : ""}
          <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#2563eb,#1e3a8a);color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:10px;">Review and sign</a>
          <p style="font-size:12px;color:#737373;margin:22px 0 0;">If the button doesn't work, paste this link into your browser:<br/><a href="${link}" style="color:#1d4ed8;word-break:break-all;">${link}</a></p>
        </td></tr>
      </table>
      <p style="font-size:11px;color:#737373;margin-top:14px;">Sent via Cuebites eSign · do not reply.</p>
    </td></tr>
  </table>
</body></html>`
}

function renderSigningText({
  recipientName,
  senderName,
  subject,
  message,
  link,
}: {
  recipientName: string
  senderName: string
  subject: string
  message: string
  link: string
}) {
  return [
    `Hi ${recipientName},`,
    "",
    `${senderName} has sent you "${subject}" to review and sign.`,
    message ? "" : null,
    message || null,
    "",
    `Open the document and sign here: ${link}`,
    "",
    "— Cuebites eSign",
  ]
    .filter((l): l is string => l !== null)
    .join("\n")
}

export async function sendTest(
  config: SmtpRuntimeConfig,
  to: string
): Promise<{ messageId: string | null }> {
  const transporter = makeTransport(config)
  await transporter.verify()
  const info = await transporter.sendMail({
    from: fromHeader(config),
    to,
    subject: "Cuebites eSign — SMTP test",
    text: "If you can read this, your SMTP config in Cuebites eSign is working.",
    html: "<p>If you can read this, your SMTP config in <strong>Cuebites eSign</strong> is working.</p>",
  })
  return { messageId: info.messageId ?? null }
}

function renderCompletedHtml({
  recipientName,
  senderName,
  subject,
}: {
  recipientName: string
  senderName: string
  subject: string
}) {
  const safeSubject = escapeHtml(subject)
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid #e5e7eb;padding:28px;">
        <tr><td>
          <div style="display:inline-flex;align-items:center;gap:8px;color:#1e3a8a;font-weight:600;font-size:14px;">
            <span style="display:inline-block;width:24px;height:24px;border-radius:6px;background:linear-gradient(135deg,#3b82f6,#1e3a8a);"></span>
            Cuebites eSign
          </div>
          <h1 style="font-size:20px;line-height:1.4;color:#0a0a0a;margin:18px 0 6px;">Hi ${escapeHtml(recipientName)},</h1>
          <p style="font-size:14px;color:#525252;margin:0 0 18px;">
            "<strong>${safeSubject}</strong>" has been signed by everyone. The fully executed copy is attached to this email for your records.
          </p>
          <p style="font-size:13px;color:#737373;margin:0;">Sent on behalf of <strong style="color:#0a0a0a;">${escapeHtml(senderName)}</strong>.</p>
        </td></tr>
      </table>
      <p style="font-size:11px;color:#737373;margin-top:14px;">Sent via Cuebites eSign · do not reply.</p>
    </td></tr>
  </table>
</body></html>`
}

function renderCompletedText({
  recipientName,
  senderName,
  subject,
}: {
  recipientName: string
  senderName: string
  subject: string
}) {
  return [
    `Hi ${recipientName},`,
    "",
    `"${subject}" has been signed by everyone.`,
    "The fully executed copy is attached for your records.",
    "",
    `Sent on behalf of ${senderName}.`,
    "",
    "— Cuebites eSign",
  ].join("\n")
}

/** Strip a `data:application/pdf;base64,` prefix if present. */
function stripDataUrlPrefix(value: string): string {
  const m = value.match(/^data:[^;]+;base64,(.*)$/)
  return m && m[1] ? m[1] : value
}

export type CompletedTarget = { name: string; email: string }

export async function sendCompletedEmails(
  config: SmtpRuntimeConfig,
  {
    subject,
    senderName,
    targets,
    attachment,
  }: {
    subject: string
    senderName: string
    targets: CompletedTarget[]
    attachment: { filename: string; contentBase64: string }
  }
) {
  const transporter = makeTransport(config)
  const pdfContent = Buffer.from(
    stripDataUrlPrefix(attachment.contentBase64),
    "base64"
  )
  const results: { email: string; ok: boolean; error?: string }[] = []
  for (const t of targets) {
    try {
      const html = renderCompletedHtml({
        recipientName: t.name,
        senderName,
        subject,
      })
      const text = renderCompletedText({
        recipientName: t.name,
        senderName,
        subject,
      })
      const info = await transporter.sendMail({
        from: fromHeader(config),
        to: `"${t.name}" <${t.email}>`,
        subject: `Signed: ${subject}`,
        text,
        html,
        attachments: [
          {
            filename: attachment.filename,
            content: pdfContent,
            contentType: "application/pdf",
          },
        ],
      })
      results.push({ email: t.email, ok: !!info.messageId })
    } catch (err) {
      results.push({
        email: t.email,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return {
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  }
}

export async function sendSigningEmails(
  config: SmtpRuntimeConfig,
  {
    subject,
    message,
    senderName,
    targets,
  }: {
    subject: string
    message?: string
    senderName: string
    targets: EmailTarget[]
  }
) {
  const transporter = makeTransport(config)
  const results: { email: string; ok: boolean; error?: string }[] = []
  for (const t of targets) {
    try {
      const html = renderSigningHtml({
        recipientName: t.name,
        senderName,
        subject,
        message: message ?? "",
        link: t.link,
      })
      const text = renderSigningText({
        recipientName: t.name,
        senderName,
        subject,
        message: message ?? "",
        link: t.link,
      })
      const info = await transporter.sendMail({
        from: fromHeader(config),
        to: `"${t.name}" <${t.email}>`,
        subject: `Please sign: ${subject}`,
        text,
        html,
      })
      results.push({ email: t.email, ok: !!info.messageId })
    } catch (err) {
      results.push({
        email: t.email,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return {
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  }
}
