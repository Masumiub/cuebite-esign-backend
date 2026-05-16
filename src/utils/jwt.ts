import jwt, { type SignOptions } from "jsonwebtoken"
import { env } from "../config/env.js"
import type { Role } from "@prisma/client"

export type SessionPayload = {
  sub: string
  email: string
  role: Role
}

export function signSession(payload: SessionPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_TTL as SignOptions["expiresIn"],
  }
  return jwt.sign(payload, env.JWT_SECRET, options)
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET)
    if (
      typeof decoded === "object" &&
      decoded &&
      typeof (decoded as { sub?: unknown }).sub === "string" &&
      typeof (decoded as { email?: unknown }).email === "string" &&
      typeof (decoded as { role?: unknown }).role === "string"
    ) {
      return {
        sub: (decoded as { sub: string }).sub,
        email: (decoded as { email: string }).email,
        role: (decoded as { role: Role }).role,
      }
    }
    return null
  } catch {
    return null
  }
}
