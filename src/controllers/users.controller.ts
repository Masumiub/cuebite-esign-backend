import type { NextFunction, Request, Response } from "express"
import { Role } from "@prisma/client"
import { z } from "zod"

import * as usersService from "../services/users.service.js"
import { ForbiddenError, UnauthorizedError } from "../utils/errors.js"

const createUserSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1).max(120),
  role: z.nativeEnum(Role).default(Role.EMPLOYEE),
})

export async function list(_req: Request, res: Response, next: NextFunction) {
  try {
    const users = await usersService.listUsers()
    res.json({ users })
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
    if (!req.user) throw new UnauthorizedError()
    const input = createUserSchema.parse(req.body)
    // Privilege escalation guard: the route lets MANAGER in so they can
    // onboard their team, but they can only mint EMPLOYEE accounts. Only
    // ADMIN can create ADMIN or MANAGER rows.
    if (req.user.role === Role.MANAGER && input.role !== Role.EMPLOYEE) {
      throw new ForbiddenError("Managers can only create employee accounts")
    }
    const user = await usersService.createUser(input)
    res.status(201).json({ user })
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
    if (!req.user) throw new UnauthorizedError()
    // Guard against an admin deleting themselves and accidentally locking
    // everyone out — at least one admin must remain reachable.
    if (req.user.id === req.params.id) {
      throw new ForbiddenError("You cannot delete your own account")
    }
    await usersService.deleteUser(req.params.id)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
}
