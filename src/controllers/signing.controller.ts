import type { NextFunction, Request, Response } from "express"
import { z } from "zod"

import * as signingService from "../services/signing.service.js"

type TokenParams = { token: string }
type FieldParams = { token: string; fieldId: string }

// ---- request schemas ------------------------------------------------------

const signatureSchema = z.object({
  kind: z.enum(["signature", "initial"]),
  dataUrl: z.string().min(1).max(2_000_000),
})

const fieldValueSchema = z.object({
  value: z.string().max(2_000_000),
})

const finishSchema = z.object({
  signedPdfBase64: z.string().max(40_000_000).optional(),
})

// ---- handlers -------------------------------------------------------------

export async function getView(
  req: Request<TokenParams>,
  res: Response,
  next: NextFunction
) {
  try {
    res.json(await signingService.getView(req.params.token))
  } catch (err) {
    next(err)
  }
}

export async function recordConsent(
  req: Request<TokenParams>,
  res: Response,
  next: NextFunction
) {
  try {
    const result = await signingService.recordConsent(req.params.token)
    res.json(result.already ? result : { envelope: result.envelope })
  } catch (err) {
    next(err)
  }
}

export async function adoptSignature(
  req: Request<TokenParams>,
  res: Response,
  next: NextFunction
) {
  try {
    const { kind, dataUrl } = signatureSchema.parse(req.body)
    await signingService.adoptSignature(req.params.token, kind, dataUrl)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
}

export async function setFieldValue(
  req: Request<FieldParams>,
  res: Response,
  next: NextFunction
) {
  try {
    const { value } = fieldValueSchema.parse(req.body)
    await signingService.setFieldValue(
      req.params.token,
      req.params.fieldId,
      value
    )
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
}

export async function finishSigning(
  req: Request<TokenParams>,
  res: Response,
  next: NextFunction
) {
  try {
    const { signedPdfBase64 } = finishSchema.parse(req.body)
    const envelope = await signingService.finishSigning(
      req.params.token,
      signedPdfBase64
    )
    res.json({ envelope })
  } catch (err) {
    next(err)
  }
}

export async function getSignedPdf(
  req: Request<TokenParams>,
  res: Response,
  next: NextFunction
) {
  try {
    res.json(await signingService.getSignedPdfByToken(req.params.token))
  } catch (err) {
    next(err)
  }
}
