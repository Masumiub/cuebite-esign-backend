import { Router } from "express"
import { Role } from "@prisma/client"

import * as envelopesController from "../controllers/envelopes.controller.js"
import { requireAuth, requireRole } from "../middleware/auth.js"

export const envelopesRouter = Router()

// Read endpoints
envelopesRouter.get("/", requireAuth, envelopesController.list)

// Static-path routes mounted BEFORE "/:id" so Express doesn't treat
// "dashboard" / "reset-demo" as an envelope id.
envelopesRouter.get("/dashboard", requireAuth, envelopesController.dashboard)
envelopesRouter.post(
  "/reset-demo",
  requireAuth,
  requireRole(Role.ADMIN),
  envelopesController.resetDemo
)

envelopesRouter.get("/:id", requireAuth, envelopesController.get)
envelopesRouter.get(
  "/:id/documents/:docId",
  requireAuth,
  envelopesController.getDocument
)
envelopesRouter.get(
  "/:id/signed-pdf",
  requireAuth,
  envelopesController.getSignedPdf
)

// Mutations
envelopesRouter.post("/", requireAuth, envelopesController.create)
envelopesRouter.delete("/:id", requireAuth, envelopesController.remove)
envelopesRouter.post("/:id/void", requireAuth, envelopesController.voidEnvelope)
