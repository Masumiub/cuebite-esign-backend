import type { NextFunction, Request, Response } from "express"
import { z } from "zod"

import * as smtpService from "../services/smtp.service.js"
import { UnauthorizedError } from "../utils/errors.js"

// ---- request schemas ------------------------------------------------------

const configSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean().default(true),
  user: z.string().email().toLowerCase(),
  /** Empty means "keep the existing password". */
  password: z.string().optional(),
  fromName: z.string().max(120).optional().nullable(),
  fromEmail: z.string().email().toLowerCase(),
})

const testSchema = z.object({
  to: z.string().email(),
  smtp: configSchema.optional(),
})

const signingTargetSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  link: z.string().url(),
})

const sendSigningSchema = z.object({
  subject: z.string().min(1).max(300),
  message: z.string().max(5000).optional(),
  senderName: z.string().max(120).optional(),
  targets: z.array(signingTargetSchema).min(1).max(50),
})

const completedTargetSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
})

const sendCompletedSchema = z.object({
  subject: z.string().min(1).max(300),
  senderName: z.string().max(120).optional(),
  targets: z.array(completedTargetSchema).min(1).max(50),
  attachment: z.object({
    filename: z.string().min(1).max(255),
    contentBase64: z.string().min(1).max(20 * 1024 * 1024),
  }),
})

// ---- handlers -------------------------------------------------------------

export async function getConfig(
  _req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    res.json(await smtpService.getPublicConfig())
  } catch (err) {
    next(err)
  }
}

export async function saveConfig(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    if (!req.user) throw new UnauthorizedError()
    const input = configSchema.parse(req.body)
    const result = await smtpService.saveConfig(input, req.user.id)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function clearConfig(
  _req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    await smtpService.clearConfig()
    res.json({ configured: false })
  } catch (err) {
    next(err)
  }
}

export async function sendTest(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { to, smtp } = testSchema.parse(req.body)
    const result = await smtpService.sendTestEmail(to, smtp)
    res.json({ ok: true, messageId: result.messageId })
  } catch (err) {
    next(err)
  }
}

export async function sendSigning(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const input = sendSigningSchema.parse(req.body)
    const result = await smtpService.sendSigningLinkEmails({
      ...input,
      fallbackSenderEmail: req.user?.email,
    })
    res.json({
      ok: result.failed === 0,
      sent: result.sent,
      failed: result.failed,
      results: result.results,
    })
  } catch (err) {
    next(err)
  }
}

export async function sendCompleted(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const input = sendCompletedSchema.parse(req.body)
    const result = await smtpService.sendCompletedPdfEmails(input)
    res.json({
      ok: result.failed === 0,
      sent: result.sent,
      failed: result.failed,
      results: result.results,
    })
  } catch (err) {
    next(err)
  }
}
