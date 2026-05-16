import type { NextFunction, Request, Response } from "express"
import type { Role } from "@prisma/client"
import { env } from "../config/env.js"
import { verifySession } from "../utils/jwt.js"

/** Reads the session cookie and attaches `req.user` if valid. */
export function attachUser(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const token = req.cookies?.[env.COOKIE_NAME]
  if (typeof token === "string" && token) {
    const session = verifySession(token)
    if (session) {
      req.user = {
        id: session.sub,
        email: session.email,
        role: session.role,
      }
    }
  }
  next()
}

/** Requires a logged-in user. */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" })
    return
  }
  next()
}

/** Requires the logged-in user to have one of the given roles. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" })
      return
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden" })
      return
    }
    next()
  }
}
