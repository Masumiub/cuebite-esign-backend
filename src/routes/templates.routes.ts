import { Router } from "express"

import * as templatesController from "../controllers/templates.controller.js"
import { requireAuth } from "../middleware/auth.js"

export const templatesRouter = Router()

// Any signed-in user can read and use templates; the service enforces
// creator-or-admin on delete.
templatesRouter.get("/", requireAuth, templatesController.list)
templatesRouter.get("/:id", requireAuth, templatesController.get)
templatesRouter.post("/", requireAuth, templatesController.create)
templatesRouter.post("/:id/use", requireAuth, templatesController.use)
templatesRouter.delete("/:id", requireAuth, templatesController.remove)
