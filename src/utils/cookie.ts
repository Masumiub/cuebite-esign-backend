import type { Response } from "express"
import { env } from "../config/env.js"

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function setSessionCookie(res: Response, token: string) {
  res.cookie(env.COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: "/",
    maxAge: SEVEN_DAYS_MS,
  })
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(env.COOKIE_NAME, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: "/",
  })
}
