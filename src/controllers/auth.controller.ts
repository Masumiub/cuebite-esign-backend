import type { NextFunction, Request, Response } from "express"
import { Role } from "@prisma/client"
import { z } from "zod"

import * as authService from "../services/auth.service.js"
import { clearSessionCookie, setSessionCookie } from "../utils/cookie.js"
import { UnauthorizedError } from "../utils/errors.js"

// ---- request schemas ------------------------------------------------------

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
})

const registerSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1).max(120),
  role: z.nativeEnum(Role).default(Role.EMPLOYEE),
})

const signupSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1).max(120),
})

// ---- handlers -------------------------------------------------------------

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const input = loginSchema.parse(req.body)
    const { user, token } = await authService.login(input)
    setSessionCookie(res, token)
    res.json({ user })
  } catch (err) {
    next(err)
  }
}

export function logout(_req: Request, res: Response) {
  clearSessionCookie(res)
  res.json({ ok: true })
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new UnauthorizedError()
    const user = await authService.getCurrentUser(req.user.id)
    if (!user) {
      // Token was valid but the underlying user row is gone. Clear the
      // cookie so the next request comes in clean.
      clearSessionCookie(res)
      throw new UnauthorizedError("Session is no longer valid")
    }
    res.json({ user })
  } catch (err) {
    next(err)
  }
}

export async function register(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const input = registerSchema.parse(req.body)
    const user = await authService.register(input)
    res.status(201).json({ user })
  } catch (err) {
    next(err)
  }
}

export async function signup(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const input = signupSchema.parse(req.body)
    const { user, token } = await authService.signup(input)
    setSessionCookie(res, token)
    res.status(201).json({ user })
  } catch (err) {
    next(err)
  }
}
