import { Router } from "express"
import { Role } from "@prisma/client"

import * as authController from "../controllers/auth.controller.js"
import { requireAuth, requireRole } from "../middleware/auth.js"

export const authRouter = Router()

authRouter.post("/login", authController.login)
authRouter.post("/logout", authController.logout)
authRouter.post("/signup", authController.signup)
authRouter.get("/me", requireAuth, authController.me)
authRouter.post(
  "/register",
  requireAuth,
  requireRole(Role.ADMIN),
  authController.register
)
