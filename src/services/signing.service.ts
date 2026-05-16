import type { EnvelopeRecipient } from "@prisma/client"

import { prisma } from "../db/prisma.js"
import {
  bufferToBase64,
  dataUrlToBuffer,
  readPdfFile,
  writeSignedPdf,
} from "../storage/files.js"
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../utils/errors.js"
import {
  ENVELOPE_INCLUDE,
  serializeEnvelope,
  type EnvelopeFull,
  type EnvelopeRow,
} from "./envelopes.serializer.js"

// ---- token plumbing -------------------------------------------------------

export function parseToken(
  token: string
): { envelopeId: string; recipientId: string } | null {
  const idx = token.indexOf("--")
  if (idx === -1) return null
  return {
    envelopeId: token.slice(0, idx),
    recipientId: token.slice(idx + 2),
  }
}

export type LoadedSigning = {
  envelope: EnvelopeRow
  recipient: EnvelopeRecipient
}

/** Resolve a signing token to {envelope, recipient}. Throws NotFoundError if
 *  either the envelope or the recipient is missing. */
export async function loadByToken(token: string): Promise<LoadedSigning> {
  const parsed = parseToken(token)
  if (!parsed) throw new NotFoundError("Signing link is invalid")
  const envelope = await prisma.envelope.findUnique({
    where: { id: parsed.envelopeId },
    include: ENVELOPE_INCLUDE,
  })
  if (!envelope) throw new NotFoundError("Signing link is invalid")
  const recipient = envelope.recipients.find(
    (r) => r.id === parsed.recipientId
  )
  if (!recipient) throw new NotFoundError("Signing link is invalid")
  return { envelope, recipient }
}

// ---- read -----------------------------------------------------------------

export type SigningView = {
  envelope: EnvelopeFull
  recipientId: string
  documentBase64: string | null
  documentName: string | null
}

export async function getView(token: string): Promise<SigningView> {
  const { envelope, recipient } = await loadByToken(token)
  const primaryDoc = envelope.documents[0]
  let documentBase64: string | null = null
  if (primaryDoc?.storagePath) {
    try {
      const buf = await readPdfFile(primaryDoc.storagePath)
      documentBase64 = bufferToBase64(buf)
    } catch {
      documentBase64 = null
    }
  }
  return {
    envelope: serializeEnvelope(envelope),
    recipientId: recipient.id,
    documentBase64,
    documentName: primaryDoc?.name ?? null,
  }
}

// ---- consent --------------------------------------------------------------

export async function recordConsent(
  token: string
): Promise<{ envelope: EnvelopeFull; already: boolean }> {
  const { envelope, recipient } = await loadByToken(token)
  if (recipient.consentAt) {
    return { envelope: serializeEnvelope(envelope), already: true }
  }
  const at = new Date()
  await prisma.envelopeRecipient.update({
    where: { id: recipient.id },
    data: { consentAt: at },
  })
  await prisma.envelopeAudit.create({
    data: {
      envelopeId: envelope.id,
      at,
      actorId: recipient.id,
      message: `${recipient.name} agreed to electronic records & signatures.`,
    },
  })
  await prisma.envelope.update({
    where: { id: envelope.id },
    data: { updatedAt: at },
  })
  const fresh = await prisma.envelope.findUniqueOrThrow({
    where: { id: envelope.id },
    include: ENVELOPE_INCLUDE,
  })
  return { envelope: serializeEnvelope(fresh), already: false }
}

// ---- adopt signature ------------------------------------------------------

export async function adoptSignature(
  token: string,
  kind: "signature" | "initial",
  dataUrl: string
): Promise<void> {
  const { recipient } = await loadByToken(token)
  await prisma.envelopeRecipient.update({
    where: { id: recipient.id },
    data:
      kind === "signature"
        ? { signatureDataUrl: dataUrl }
        : { initialDataUrl: dataUrl },
  })
}

// ---- set field value ------------------------------------------------------

export async function setFieldValue(
  token: string,
  fieldId: string,
  value: string
): Promise<void> {
  const { envelope, recipient } = await loadByToken(token)
  const field = await prisma.envelopeField.findUnique({ where: { id: fieldId } })
  if (!field || field.envelopeId !== envelope.id) {
    throw new NotFoundError("Field not found")
  }
  if (field.recipientId !== recipient.id) {
    throw new ForbiddenError("This field belongs to another recipient")
  }
  await prisma.envelopeField.update({
    where: { id: field.id },
    data: { value },
  })
}

// ---- finish ---------------------------------------------------------------

export async function finishSigning(
  token: string,
  signedPdfBase64: string | undefined
): Promise<EnvelopeFull> {
  const { envelope, recipient } = await loadByToken(token)
  if (
    envelope.status === "voided" ||
    envelope.status === "expired" ||
    envelope.status === "declined"
  ) {
    throw new ConflictError(
      `This envelope is ${envelope.status} — signing is closed.`
    )
  }

  const at = new Date()
  await prisma.envelopeRecipient.update({
    where: { id: recipient.id },
    data: { status: "signed", signedAt: at },
  })
  await prisma.envelopeAudit.create({
    data: {
      envelopeId: envelope.id,
      at,
      actorId: recipient.id,
      message: `${recipient.name} signed.`,
    },
  })

  // Re-check everyone's status to see if the envelope is now fully signed.
  const refreshed = await prisma.envelope.findUniqueOrThrow({
    where: { id: envelope.id },
    include: ENVELOPE_INCLUDE,
  })
  const allSigned = refreshed.recipients.every((r) => r.status === "signed")
  const newStatus = allSigned ? "completed" : "partially_signed"

  await prisma.envelope.update({
    where: { id: envelope.id },
    data: {
      status: newStatus,
      completedAt: allSigned ? at : null,
      updatedAt: at,
    },
  })

  if (allSigned) {
    await prisma.envelopeAudit.create({
      data: {
        envelopeId: envelope.id,
        at,
        message: "Envelope completed.",
      },
    })
    if (signedPdfBase64) {
      try {
        const buf = dataUrlToBuffer(signedPdfBase64)
        const { storagePath, byteSize } = await writeSignedPdf(
          envelope.id,
          buf
        )
        await prisma.envelopeSignedPdf.upsert({
          where: { envelopeId: envelope.id },
          create: { envelopeId: envelope.id, storagePath, byteSize },
          update: { storagePath, byteSize },
        })
      } catch (err) {
        // Failing to save the signed copy shouldn't block the signing
        // completion — log and move on.
        console.error("[signing] failed to store signed PDF:", err)
      }
    }
  }

  const fresh = await prisma.envelope.findUniqueOrThrow({
    where: { id: envelope.id },
    include: ENVELOPE_INCLUDE,
  })
  return serializeEnvelope(fresh)
}

// ---- signed-pdf download --------------------------------------------------

export async function getSignedPdfByToken(
  token: string
): Promise<{ filename: string; contentBase64: string }> {
  const { envelope } = await loadByToken(token)
  const signedPdf = await prisma.envelopeSignedPdf.findUnique({
    where: { envelopeId: envelope.id },
  })
  if (!signedPdf) throw new NotFoundError("No signed copy yet")
  const buf = await readPdfFile(signedPdf.storagePath)
  return {
    filename: `${envelope.subject} (signed).pdf`,
    contentBase64: bufferToBase64(buf),
  }
}
