import { Router } from "express"

import * as signingController from "../controllers/signing.controller.js"

export const signingRouter = Router()

// All public — anonymous recipients with a valid token. The service throws
// 404 if the token is unrecognised, 403 if a recipient tries to touch
// somebody else's field.
signingRouter.get("/:token", signingController.getView)
signingRouter.get("/:token/signed-pdf", signingController.getSignedPdf)
signingRouter.post("/:token/consent", signingController.recordConsent)
signingRouter.post("/:token/signature", signingController.adoptSignature)
signingRouter.post(
  "/:token/fields/:fieldId",
  signingController.setFieldValue
)
signingRouter.post("/:token/finish", signingController.finishSigning)
