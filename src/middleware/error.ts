import type { NextFunction, Request, Response } from "express"
import { ZodError } from "zod"

import { HttpError } from "../utils/errors.js"

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Not found" })
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Invalid request",
      details: err.flatten().fieldErrors,
    })
    return
  }
  if (err instanceof HttpError) {
    const body: Record<string, unknown> = { error: err.message }
    if (err.details !== undefined) body.details = err.details
    res.status(err.status).json(body)
    return
  }
  const message = err instanceof Error ? err.message : "Unknown error"
  console.error("[error]", err)
  res.status(500).json({ error: message })
}
