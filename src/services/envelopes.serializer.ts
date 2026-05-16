import type {
  Envelope,
  EnvelopeAudit,
  EnvelopeDocument,
  EnvelopeField,
  EnvelopeRecipient,
  EnvelopeSignedPdf,
} from "@prisma/client"

/** Shape returned from /envelopes/:id and /sign/:token. */
export type EnvelopeFull = {
  id: string
  subject: string
  message: string
  status: Envelope["status"]
  routingMode: Envelope["routingMode"]
  createdAt: string
  updatedAt: string
  sentAt: string | null
  completedAt: string | null
  createdById: string | null
  documents: {
    id: string
    name: string
    pageCount: number
    byteSize: number
    hasContent: boolean
  }[]
  recipients: {
    id: string
    name: string
    email: string
    color: string
    order: number
    status: EnvelopeRecipient["status"]
    consentAt: string | null
    signedAt: string | null
    signatureDataUrl: string | null
    initialDataUrl: string | null
  }[]
  fields: {
    id: string
    type: EnvelopeField["type"]
    recipientId: string
    documentId: string
    page: number
    x: number
    y: number
    width: number
    height: number
    required: boolean
  }[]
  fieldValues: Record<string, string>
  audit: { id: string; at: string; actorId: string | null; message: string }[]
  hasSignedPdf: boolean
}

export type EnvelopeRow = Envelope & {
  documents: EnvelopeDocument[]
  recipients: EnvelopeRecipient[]
  fields: EnvelopeField[]
  audits: EnvelopeAudit[]
  signedPdf: EnvelopeSignedPdf | null
}

export function serializeEnvelope(row: EnvelopeRow): EnvelopeFull {
  // Build field-values map. Only fields with a non-null `value` make it in.
  const fieldValues: Record<string, string> = {}
  for (const f of row.fields) {
    if (f.value !== null && f.value !== undefined) {
      fieldValues[f.id] = f.value
    }
  }
  return {
    id: row.id,
    subject: row.subject,
    message: row.message,
    status: row.status,
    routingMode: row.routingMode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdById: row.createdById,
    documents: row.documents.map((d) => ({
      id: d.id,
      name: d.name,
      pageCount: d.pageCount,
      byteSize: d.byteSize,
      hasContent: !!d.storagePath,
    })),
    recipients: row.recipients
      .sort((a, b) => a.order - b.order)
      .map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        color: r.color,
        order: r.order,
        status: r.status,
        consentAt: r.consentAt?.toISOString() ?? null,
        signedAt: r.signedAt?.toISOString() ?? null,
        signatureDataUrl: r.signatureDataUrl,
        initialDataUrl: r.initialDataUrl,
      })),
    fields: row.fields.map((f) => ({
      id: f.id,
      type: f.type,
      recipientId: f.recipientId,
      documentId: f.documentId,
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      required: f.required,
    })),
    fieldValues,
    audit: row.audits
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map((a) => ({
        id: a.id,
        at: a.at.toISOString(),
        actorId: a.actorId,
        message: a.message,
      })),
    hasSignedPdf: !!row.signedPdf,
  }
}

/** Slim row for the list page. Audit / fields / field values are omitted. */
export type EnvelopeListItem = {
  id: string
  subject: string
  status: Envelope["status"]
  routingMode: Envelope["routingMode"]
  createdAt: string
  updatedAt: string
  sentAt: string | null
  completedAt: string | null
  createdById: string | null
  documents: { id: string; name: string; pageCount: number }[]
  recipients: {
    id: string
    name: string
    email: string
    color: string
    order: number
    status: EnvelopeRecipient["status"]
  }[]
  fieldsCount: number
  hasSignedPdf: boolean
}

export function serializeEnvelopeListItem(row: EnvelopeRow): EnvelopeListItem {
  return {
    id: row.id,
    subject: row.subject,
    status: row.status,
    routingMode: row.routingMode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdById: row.createdById,
    documents: row.documents.map((d) => ({
      id: d.id,
      name: d.name,
      pageCount: d.pageCount,
    })),
    recipients: row.recipients
      .sort((a, b) => a.order - b.order)
      .map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        color: r.color,
        order: r.order,
        status: r.status,
      })),
    fieldsCount: row.fields.length,
    hasSignedPdf: !!row.signedPdf,
  }
}

export const ENVELOPE_INCLUDE = {
  documents: true,
  recipients: true,
  fields: true,
  audits: true,
  signedPdf: true,
} as const
