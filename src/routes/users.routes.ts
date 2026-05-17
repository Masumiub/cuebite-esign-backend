import { Router } from "express"
import { Role } from "@prisma/client"

import * as usersController from "../controllers/users.controller.js"
import { requireAuth, requireRole } from "../middleware/auth.js"

export const usersRouter = Router()

usersRouter.get(
  "/",
  requireAuth,
  requireRole(Role.ADMIN, Role.MANAGER),
  usersController.list
)

usersRouter.post(
  "/",
  requireAuth,
  requireRole(Role.ADMIN, Role.MANAGER),
  usersController.create
)

usersRouter.delete(
  "/:id",
  requireAuth,
  requireRole(Role.ADMIN),
  usersController.remove
)
