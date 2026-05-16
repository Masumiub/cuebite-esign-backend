import { prisma } from "../db/prisma.js"
import {
  sendCompletedEmails,
  sendSigningEmails,
  sendTest,
  type CompletedTarget,
  type EmailTarget,
  type SmtpRuntimeConfig,
} from "./smtp.mailer.js"
import { decryptSecret, encryptSecret } from "../utils/crypto.js"
import { BadRequestError } from "../utils/errors.js"

const SINGLETON_ID = "default"

export type SmtpConfigInput = {
  host: string
  port: number
  secure: boolean
  user: string
  /** Empty means "keep the existing password". */
  password?: string
  fromName?: string | null
  fromEmail: string
}

export type SmtpConfigPublic = {
  host: string
  port: number
  secure: boolean
  user: string
  fromName: string | null
  fromEmail: string
  updatedAt: Date
  passwordSet: boolean
}

function publicConfig(row: {
  host: string
  port: number
  secure: boolean
  user: string
  fromName: string | null
  fromEmail: string
  updatedAt: Date
}): SmtpConfigPublic {
  return {
    host: row.host,
    port: row.port,
    secure: row.secure,
    user: row.user,
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    updatedAt: row.updatedAt,
    passwordSet: true,
  }
}

/** Returns the saved config minus the encrypted password. */
export async function getPublicConfig(): Promise<{
  configured: boolean
  config: SmtpConfigPublic | null
}> {
  const row = await prisma.smtpConfig.findUnique({
    where: { id: SINGLETON_ID },
  })
  if (!row) return { configured: false, config: null }
  return { configured: true, config: publicConfig(row) }
}

/** Decrypts the stored config so it can be handed to the mailer. */
export async function getRuntimeConfig(): Promise<SmtpRuntimeConfig | null> {
  const row = await prisma.smtpConfig.findUnique({
    where: { id: SINGLETON_ID },
  })
  if (!row) return null
  return {
    host: row.host,
    port: row.port,
    secure: row.secure,
    user: row.user,
    password: decryptSecret(row.passwordEncrypted),
    fromName: row.fromName,
    fromEmail: row.fromEmail,
  }
}

/**
 * Upsert SMTP config. If `password` is empty on update, the existing
 * encrypted password is kept. First-time saves require a password.
 */
export async function saveConfig(
  input: SmtpConfigInput,
  updatedById: string
): Promise<{ configured: boolean; config: SmtpConfigPublic }> {
  const existing = await prisma.smtpConfig.findUnique({
    where: { id: SINGLETON_ID },
  })

  let passwordEncrypted: string
  if (input.password && input.password.length > 0) {
    passwordEncrypted = encryptSecret(input.password)
  } else if (existing) {
    passwordEncrypted = existing.passwordEncrypted
  } else {
    throw new BadRequestError(
      "Password is required when saving SMTP for the first time."
    )
  }

  const row = await prisma.smtpConfig.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      host: input.host,
      port: input.port,
      secure: input.secure,
      user: input.user,
      passwordEncrypted,
      fromName: input.fromName ?? null,
      fromEmail: input.fromEmail,
      updatedById,
    },
    update: {
      host: input.host,
      port: input.port,
      secure: input.secure,
      user: input.user,
      passwordEncrypted,
      fromName: input.fromName ?? null,
      fromEmail: input.fromEmail,
      updatedById,
    },
  })
  return { configured: true, config: publicConfig(row) }
}

export async function clearConfig(): Promise<void> {
  await prisma.smtpConfig.deleteMany({ where: { id: SINGLETON_ID } })
}

/**
 * Send a test email. Optional override lets admins try a draft config
 * before saving — if the password is left blank in the override, we fall
 * back to the stored password.
 */
export async function sendTestEmail(
  to: string,
  override: SmtpConfigInput | undefined
): Promise<{ messageId: string | null }> {
  let runtime: SmtpRuntimeConfig | null
  if (override) {
    if (!override.password) {
      const stored = await getRuntimeConfig()
      if (!stored) {
        throw new BadRequestError("Password is required for the test.")
      }
      runtime = {
        host: override.host,
        port: override.port,
        secure: override.secure,
        user: override.user,
        password: stored.password,
        fromName: override.fromName ?? null,
        fromEmail: override.fromEmail,
      }
    } else {
      runtime = {
        host: override.host,
        port: override.port,
        secure: override.secure,
        user: override.user,
        password: override.password,
        fromName: override.fromName ?? null,
        fromEmail: override.fromEmail,
      }
    }
  } else {
    runtime = await getRuntimeConfig()
    if (!runtime) throw new BadRequestError("No SMTP config saved yet.")
  }
  return sendTest(runtime, to)
}

export type SendSigningInput = {
  subject: string
  message?: string
  senderName?: string
  fallbackSenderEmail?: string
  targets: EmailTarget[]
}

export async function sendSigningLinkEmails(input: SendSigningInput) {
  const runtime = await getRuntimeConfig()
  if (!runtime) {
    throw new BadRequestError(
      "SMTP is not configured. Ask an admin to set it up in Settings."
    )
  }
  const senderName =
    input.senderName ||
    runtime.fromName ||
    input.fallbackSenderEmail ||
    "Cuebites eSign"
  return sendSigningEmails(runtime, {
    subject: input.subject,
    message: input.message,
    senderName,
    targets: input.targets,
  })
}

export type SendCompletedInput = {
  subject: string
  senderName?: string
  targets: CompletedTarget[]
  attachment: { filename: string; contentBase64: string }
}

export async function sendCompletedPdfEmails(input: SendCompletedInput) {
  const runtime = await getRuntimeConfig()
  if (!runtime) throw new BadRequestError("SMTP is not configured.")
  const senderName =
    input.senderName || runtime.fromName || "Cuebites eSign"
  return sendCompletedEmails(runtime, {
    subject: input.subject,
    senderName,
    targets: input.targets,
    attachment: input.attachment,
  })
}
