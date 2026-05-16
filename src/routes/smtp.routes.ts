import { Router } from "express"
import { Role } from "@prisma/client"

import * as smtpController from "../controllers/smtp.controller.js"
import { requireAuth, requireRole } from "../middleware/auth.js"

export const smtpRouter = Router()

// Admin-only config CRUD.
smtpRouter.get("/", requireAuth, requireRole(Role.ADMIN), smtpController.getConfig)
smtpRouter.put("/", requireAuth, requireRole(Role.ADMIN), smtpController.saveConfig)
smtpRouter.delete(
  "/",
  requireAuth,
  requireRole(Role.ADMIN),
  smtpController.clearConfig
)
smtpRouter.post(
  "/test",
  requireAuth,
  requireRole(Role.ADMIN),
  smtpController.sendTest
)

// Any logged-in user (e.g. a sender finishing the wizard) can email signing
// links — they aren't editing config, just using it.
smtpRouter.post("/send-signing", requireAuth, smtpController.sendSigning)

// Public: anonymous recipients trigger this after they finish signing.
// The token check is the security boundary; if a public attacker hits this
// without a valid signing flow they just spam emails to themselves.
smtpRouter.post("/send-completed", smtpController.sendCompleted)
