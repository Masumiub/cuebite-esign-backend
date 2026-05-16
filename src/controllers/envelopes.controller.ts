import type { NextFunction, Request, Response } from "express"
import { z } from "zod"

import * as envelopesService from "../services/envelopes.service.js"
import { UnauthorizedError } from "../utils/errors.js"

type IdParams = { id: string }
type DocParams = { id: string; docId: string }

// ---- request schemas ------------------------------------------------------

const envelopeStatusEnum = z.enum([
  "draft",
  "sent",
  "partially_signed",
  "completed",
  "declined",
  "voided",
  "expired",
])
type EnvelopeStatusInput = z.infer<typeof envelopeStatusEnum>

/** Query string for `GET /envelopes`. The `status` param accepts a single
 *  status or a comma-separated list (`?status=sent,partially_signed`). */
const listQuerySchema = z.object({
  search: z.string().trim().max(300).optional(),
  status: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
})

function parseStatuses(input: string | undefined): EnvelopeStatusInput[] {
  if (!input) return []
  const valid = new Set(envelopeStatusEnum.options)
  return input
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is EnvelopeStatusInput => valid.has(s as EnvelopeStatusInput))
}

const fieldTypeEnum = z.enum([
  "signature",
  "initial",
  "date",
  "text",
  "checkbox",
])
const routingModeEnum = z.enum(["sequential", "parallel"])

const createSchema = z.object({
  subject: z.string().min(1).max(300),
  message: z.string().max(5000).optional().default(""),
  routingMode: routingModeEnum.optional().default("sequential"),
  /** Default true — the wizard sends immediately on submit. */
  send: z.boolean().optional().default(true),
  documents: z
    .array(
      z.object({
        name: z.string().min(1).max(300),
        pageCount: z.number().int().nonnegative().optional().default(0),
        /** Either a data URL or raw base64. Optional — seed demos may skip. */
        contentBase64: z.string().optional(),
      })
    )
    .min(1)
    .max(5),
  recipients: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        email: z.string().email().toLowerCase(),
        color: z.string().min(1).max(20),
        order: z.number().int().nonnegative(),
      })
    )
    .min(1)
    .max(20),
  fields: z
    .array(
      z.object({
        recipientIndex: z.number().int().nonnegative(),
        documentIndex: z.number().int().nonnegative(),
        type: fieldTypeEnum,
        page: z.number().int().min(1),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().min(0).max(1),
        height: z.number().min(0).max(1),
        required: z.boolean().optional().default(true),
      })
    )
    .max(200)
    .optional()
    .default([]),
})

// ---- handlers -------------------------------------------------------------

function caller(req: Request): { id: string; role: import("@prisma/client").Role } {
  if (!req.user) throw new UnauthorizedError()
  return req.user
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const query = listQuerySchema.parse(req.query)
    const statuses = parseStatuses(query.status)
    const result = await envelopesService.listEnvelopes(caller(req), {
      search: query.search,
      statuses,
      page: query.page,
      limit: query.limit,
    })
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function get(
  req: Request<IdParams>,
  res: Response,
  next: NextFunction
) {
  try {
    const envelope = await envelopesService.getEnvelope(
      caller(req),
      req.params.id
    )
    res.json({ envelope })
  } catch (err) {
    next(err)
  }
}

export async function getDocument(
  req: Request<DocParams>,
  res: Response,
  next: NextFunction
) {
  try {
    const result = await envelopesService.getDocumentContent(
      caller(req),
      req.params.id,
      req.params.docId
    )
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function getSignedPdf(
  req: Request<IdParams>,
  res: Response,
  next: NextFunction
) {
  try {
    const result = await envelopesService.getSignedPdf(
      caller(req),
      req.params.id
    )
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const input = createSchema.parse(req.body)
    const envelope = await envelopesService.createEnvelope(caller(req), input)
    res.status(201).json({ envelope })
  } catch (err) {
    next(err)
  }
}

export async function remove(
  req: Request<IdParams>,
  res: Response,
  next: NextFunction
) {
  try {
    await envelopesService.deleteEnvelope(caller(req), req.params.id)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
}

export async function voidEnvelope(
  req: Request<IdParams>,
  res: Response,
  next: NextFunction
) {
  try {
    const envelope = await envelopesService.voidEnvelope(
      caller(req),
      req.params.id
    )
    res.json({ envelope })
  } catch (err) {
    next(err)
  }
}

export async function resetDemo(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const me = caller(req)
    const result = await envelopesService.resetDemoEnvelopes(me.id)
    res.json({ ok: true, created: result.created })
  } catch (err) {
    next(err)
  }
}

export async function dashboard(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const result = await envelopesService.getDashboard(caller(req))
    res.json(result)
  } catch (err) {
    next(err)
  }
}
