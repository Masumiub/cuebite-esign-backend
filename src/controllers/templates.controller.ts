import type { NextFunction, Request, Response } from "express"
import { TemplateCategory } from "@prisma/client"
import { z } from "zod"

import * as templatesService from "../services/templates.service.js"
import { UnauthorizedError } from "../utils/errors.js"

function caller(req: Request) {
  if (!req.user) throw new UnauthorizedError()
  return { id: req.user.id, role: req.user.role }
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(""),
  category: z.nativeEnum(TemplateCategory),
  iconKey: z.string().max(64).optional(),
  documentName: z.string().min(1).max(255),
  pageCount: z.number().int().nonnegative().default(0),
  contentBase64: z.string().min(10, "PDF content is required"),
})

export async function list(_req: Request, res: Response, next: NextFunction) {
  try {
    const templates = await templatesService.listTemplates()
    res.json({ templates })
  } catch (err) {
    next(err)
  }
}

export async function get(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    const template = await templatesService.getTemplate(req.params.id)
    res.json({ template })
  } catch (err) {
    next(err)
  }
}

export async function getDocument(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    const result = await templatesService.getTemplateDocument(req.params.id)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function create(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const input = createSchema.parse(req.body)
    const template = await templatesService.createTemplate(caller(req), input)
    res.status(201).json({ template })
  } catch (err) {
    next(err)
  }
}

export async function remove(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    await templatesService.deleteTemplate(caller(req), req.params.id)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
}

export async function use(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    const result = await templatesService.useTemplate(req.params.id)
    res.json(result)
  } catch (err) {
    next(err)
  }
}
