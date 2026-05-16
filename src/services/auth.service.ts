import { Role, type User } from "@prisma/client"

import { prisma } from "../db/prisma.js"
import { ConflictError, UnauthorizedError } from "../utils/errors.js"
import { signSession, type SessionPayload } from "../utils/jwt.js"
import { hashPassword, verifyPassword } from "../utils/password.js"

export type PublicUser = Pick<User, "id" | "email" | "name" | "role">

function publicUser(u: User): PublicUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role }
}

export type LoginInput = { email: string; password: string }
export type LoginResult = { user: PublicUser; token: string }

/**
 * Verifies credentials and mints a session token. The controller is
 * responsible for setting the cookie — the service stays HTTP-agnostic.
 *
 * The same generic "Invalid email or password" message is returned for both
 * unknown-email and wrong-password to prevent user enumeration.
 */
export async function login(input: LoginInput): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
  })
  if (!user) throw new UnauthorizedError("Invalid email or password")
  const ok = await verifyPassword(input.password, user.passwordHash)
  if (!ok) throw new UnauthorizedError("Invalid email or password")
  const payload: SessionPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
  }
  return { user: publicUser(user), token: signSession(payload) }
}

/** Loads the user behind a verified session. Returns `null` if the row
 *  vanished while the token was still valid (user deleted, etc.). */
export async function getCurrentUser(
  userId: string
): Promise<PublicUser | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  return user ? publicUser(user) : null
}

export type RegisterInput = {
  email: string
  password: string
  name: string
  role: Role
}

export async function register(input: RegisterInput): Promise<PublicUser> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
  })
  if (existing) {
    throw new ConflictError("A user with that email already exists")
  }
  const passwordHash = await hashPassword(input.password)
  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      role: input.role,
      passwordHash,
    },
  })
  return publicUser(user)
}
