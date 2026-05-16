import { Role } from "@prisma/client"

import { prisma } from "../db/prisma.js"
import { ConflictError, NotFoundError } from "../utils/errors.js"
import { hashPassword } from "../utils/password.js"

/** Shape returned to API consumers — never include `passwordHash`. */
const publicSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
} as const

/** List every user, newest first. */
export async function listUsers() {
  return prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: publicSelect,
  })
}

export type CreateUserInput = {
  email: string
  password: string
  name: string
  role: Role
}

/** Create a new user. 409 if the email is already taken. */
export async function createUser(input: CreateUserInput) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
  })
  if (existing) {
    throw new ConflictError("A user with that email already exists")
  }
  const passwordHash = await hashPassword(input.password)
  return prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      role: input.role,
      passwordHash,
    },
    select: publicSelect,
  })
}

/** Delete a user by id. 404 if no such row. */
export async function deleteUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) throw new NotFoundError("User not found")
  await prisma.user.delete({ where: { id } })
}
