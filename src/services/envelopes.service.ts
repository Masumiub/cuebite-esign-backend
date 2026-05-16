import { Role } from "@prisma/client"
import type {
  EnvelopeStatus,
  FieldType,
  Prisma,
  RoutingMode,
} from "@prisma/client"

import { prisma } from "../db/prisma.js"
import { seedDemoEnvelopes } from "../seed/envelopes.js"
import {
  bufferToBase64,
  dataUrlToBuffer,
  readPdfFile,
  removeEnvelopeFiles,
  writeDocument,
} from "../storage/files.js"
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../utils/errors.js"
import {
  ENVELOPE_INCLUDE,
  serializeEnvelope,
  serializeEnvelopeListItem,
  type EnvelopeFull,
  type EnvelopeListItem,
} from "./envelopes.serializer.js"

export type Caller = { id: string; role: Role }

/** Creator-or-admin gate. Throws `ForbiddenError` if the caller can't touch
 *  this envelope. Centralised here so every mutation is consistent. */
export function assertCanAccess(caller: Caller, ownerId: string | null): void {
  if (caller.role === Role.ADMIN) return
  if (ownerId !== null && ownerId === caller.id) return
  throw new ForbiddenError()
}

// ---- list / get -----------------------------------------------------------

export type ListMeta = {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

export type ListStats = {
  total: number
  drafts: number
  awaiting: number
  completed: number
}

export type ListEnvelopesResult = {
  envelopes: EnvelopeListItem[]
  meta: ListMeta
  stats: ListStats
}

export type ListEnvelopesOpts = {
  /** Case-insensitive substring match against `subject`. */
  search?: string
  /** One or more envelope statuses. Empty/omitted = no status filter. */
  statuses?: EnvelopeStatus[]
  /** 1-indexed page number. */
  page: number
  /** Page size. Service clamps to a sane range; controller validates first. */
  limit: number
}

/**
 * Stats are computed across the caller's *whole* envelope set, ignoring
 * search/status filters. This way the KPI cards on the page stay stable
 * while the user is filtering or searching.
 */
async function computeStats(scope: Prisma.EnvelopeWhereInput): Promise<ListStats> {
  const groups = await prisma.envelope.groupBy({
    by: ["status"],
    where: scope,
    _count: { _all: true },
  })
  let total = 0
  let drafts = 0
  let awaiting = 0
  let completed = 0
  for (const g of groups) {
    const count = g._count._all
    total += count
    if (g.status === "draft") drafts += count
    else if (g.status === "sent" || g.status === "partially_signed")
      awaiting += count
    else if (g.status === "completed") completed += count
  }
  return { total, drafts, awaiting, completed }
}

export async function listEnvelopes(
  caller: Caller,
  opts: ListEnvelopesOpts
): Promise<ListEnvelopesResult> {
  // Visibility scope first — admins see everything; everyone else sees only
  // envelopes they created. Stats and the page query both run under this.
  const scope: Prisma.EnvelopeWhereInput =
    caller.role === Role.ADMIN ? {} : { createdById: caller.id }

  // Filter clause on top of the scope, applied only to the paginated list.
  const where: Prisma.EnvelopeWhereInput = { ...scope }
  if (opts.search && opts.search.length > 0) {
    where.subject = { contains: opts.search, mode: "insensitive" }
  }
  if (opts.statuses && opts.statuses.length > 0) {
    where.status = { in: opts.statuses }
  }

  const page = Math.max(1, opts.page)
  const limit = Math.max(1, Math.min(100, opts.limit))
  const skip = (page - 1) * limit

  // One transaction = consistent total-count vs. page-rows even if envelopes
  // are created/deleted between the two queries.
  const [total, rows] = await prisma.$transaction([
    prisma.envelope.count({ where }),
    prisma.envelope.findMany({
      where,
      include: ENVELOPE_INCLUDE,
      orderBy: { updatedAt: "desc" },
      skip,
      take: limit,
    }),
  ])

  // Stats are computed against the un-filtered scope so the KPI cards stay
  // stable while the user is searching / filtering. Run separately because
  // groupBy isn't allowed inside an array-form $transaction.
  const stats = await computeStats(scope)

  const totalPages = Math.max(1, Math.ceil(total / limit))
  const meta: ListMeta = {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  }

  return {
    envelopes: rows.map(serializeEnvelopeListItem),
    meta,
    stats,
  }
}

export async function getEnvelope(
  caller: Caller,
  id: string
): Promise<EnvelopeFull> {
  const row = await prisma.envelope.findUnique({
    where: { id },
    include: ENVELOPE_INCLUDE,
  })
  if (!row) throw new NotFoundError("Envelope not found")
  assertCanAccess(caller, row.createdById)
  return serializeEnvelope(row)
}

// ---- file downloads -------------------------------------------------------

export type DocumentDownload = {
  name: string
  pageCount: number
  contentBase64: string
}

export async function getDocumentContent(
  caller: Caller,
  envelopeId: string,
  documentId: string
): Promise<DocumentDownload> {
  const doc = await prisma.envelopeDocument.findUnique({
    where: { id: documentId },
    include: { envelope: true },
  })
  if (!doc || doc.envelopeId !== envelopeId) {
    throw new NotFoundError("Document not found")
  }
  assertCanAccess(caller, doc.envelope.createdById)
  if (!doc.storagePath) {
    throw new NotFoundError("Document content is not stored")
  }
  const buf = await readPdfFile(doc.storagePath)
  return {
    name: doc.name,
    pageCount: doc.pageCount,
    contentBase64: bufferToBase64(buf),
  }
}

export type SignedPdfDownload = { filename: string; contentBase64: string }

export async function getSignedPdf(
  caller: Caller,
  envelopeId: string
): Promise<SignedPdfDownload> {
  const env = await prisma.envelope.findUnique({
    where: { id: envelopeId },
    include: { signedPdf: true },
  })
  if (!env) throw new NotFoundError("Envelope not found")
  assertCanAccess(caller, env.createdById)
  if (!env.signedPdf) throw new NotFoundError("No signed copy yet")
  const buf = await readPdfFile(env.signedPdf.storagePath)
  return {
    filename: `${env.subject} (signed).pdf`,
    contentBase64: bufferToBase64(buf),
  }
}

// ---- create ---------------------------------------------------------------

export type CreateInput = {
  subject: string
  message: string
  routingMode: RoutingMode
  send: boolean
  documents: {
    name: string
    pageCount: number
    contentBase64?: string
  }[]
  recipients: {
    name: string
    email: string
    color: string
    order: number
  }[]
  fields: {
    recipientIndex: number
    documentIndex: number
    type: FieldType
    page: number
    x: number
    y: number
    width: number
    height: number
    required: boolean
  }[]
}

export async function createEnvelope(
  caller: Caller,
  input: CreateInput
): Promise<EnvelopeFull> {
  const now = new Date()

  // Build the parent row + simple children in one create call. We resolve
  // field.recipientId / field.documentId by index in a second step once the
  // rows have ids.
  const created = await prisma.envelope.create({
    data: {
      subject: input.subject,
      message: input.message,
      routingMode: input.routingMode,
      status: input.send ? "sent" : "draft",
      sentAt: input.send ? now : null,
      createdById: caller.id,
      recipients: {
        create: input.recipients.map((r) => ({
          ...r,
          status: input.send ? ("sent" as const) : ("pending" as const),
        })),
      },
      documents: {
        create: input.documents.map((d) => ({
          name: d.name,
          pageCount: d.pageCount,
        })),
      },
      audits: {
        create: [
          { at: now, actorId: caller.id, message: "Envelope created." },
          ...(input.send
            ? [
                {
                  at: now,
                  actorId: caller.id,
                  message: `Sent to ${input.recipients.length} recipient${
                    input.recipients.length === 1 ? "" : "s"
                  } with ${input.fields.length} field${
                    input.fields.length === 1 ? "" : "s"
                  }.`,
                },
              ]
            : []),
        ],
      },
    },
    include: ENVELOPE_INCLUDE,
  })

  // Write PDF bytes to disk; if any write fails roll back the entire envelope
  // so we don't leave half-baked rows in the DB.
  const docByIndex: typeof created.documents = []
  try {
    for (let i = 0; i < input.documents.length; i++) {
      const docMeta = created.documents[i]
      if (!docMeta) continue
      docByIndex[i] = docMeta
      const supplied = input.documents[i]
      if (supplied?.contentBase64) {
        const buf = dataUrlToBuffer(supplied.contentBase64)
        const { storagePath, byteSize } = await writeDocument(
          created.id,
          docMeta.id,
          buf
        )
        await prisma.envelopeDocument.update({
          where: { id: docMeta.id },
          data: { storagePath, byteSize },
        })
      }
    }
  } catch (err) {
    await prisma.envelope.delete({ where: { id: created.id } })
    await removeEnvelopeFiles(created.id)
    throw err
  }

  if (input.fields.length > 0) {
    const fieldsData = input.fields
      .map((f) => {
        const recipient = created.recipients[f.recipientIndex]
        const doc = docByIndex[f.documentIndex]
        if (!recipient || !doc) return null
        return {
          envelopeId: created.id,
          recipientId: recipient.id,
          documentId: doc.id,
          type: f.type,
          page: f.page,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          required: f.required,
        }
      })
      .filter((f): f is NonNullable<typeof f> => f !== null)
    if (fieldsData.length > 0) {
      await prisma.envelopeField.createMany({ data: fieldsData })
    }
  }

  // Re-fetch with everything attached so the serializer sees the saved state.
  const fresh = await prisma.envelope.findUniqueOrThrow({
    where: { id: created.id },
    include: ENVELOPE_INCLUDE,
  })
  return serializeEnvelope(fresh)
}

// ---- delete / void --------------------------------------------------------

export async function deleteEnvelope(
  caller: Caller,
  id: string
): Promise<void> {
  const row = await prisma.envelope.findUnique({
    where: { id },
    select: { id: true, createdById: true },
  })
  if (!row) throw new NotFoundError("Envelope not found")
  assertCanAccess(caller, row.createdById)
  await prisma.envelope.delete({ where: { id: row.id } })
  await removeEnvelopeFiles(row.id)
}

export async function voidEnvelope(
  caller: Caller,
  id: string
): Promise<EnvelopeFull> {
  const row = await prisma.envelope.findUnique({
    where: { id },
    include: ENVELOPE_INCLUDE,
  })
  if (!row) throw new NotFoundError("Envelope not found")
  assertCanAccess(caller, row.createdById)
  if (row.status === "completed" || row.status === "voided") {
    throw new ConflictError(
      `Cannot void an envelope that is already ${row.status}.`
    )
  }
  const updated = await prisma.envelope.update({
    where: { id: row.id },
    data: {
      status: "voided",
      audits: {
        create: { actorId: caller.id, message: "Envelope voided." },
      },
    },
    include: ENVELOPE_INCLUDE,
  })
  return serializeEnvelope(updated)
}

// ---- seed reset (admin) ---------------------------------------------------

export async function resetDemoEnvelopes(
  callerId: string
): Promise<{ created: number }> {
  // Wipe every envelope the caller created. Old PDFs on disk become orphans —
  // acceptable for a demo reset; a real cleanup job can sweep those later.
  await prisma.envelope.deleteMany({ where: { createdById: callerId } })
  const result = await seedDemoEnvelopes(prisma, callerId)
  return { created: result.length }
}

// ---- dashboard ------------------------------------------------------------

export type DashboardStats = ListStats & {
  /** completed / (total - drafts), rounded to 0-100. 0 if no sent envelopes. */
  completionRate: number
  /** Average ms between sentAt and completedAt across completed envelopes
   *  (sampled — at most a few hundred recent ones). 0 if there are none. */
  avgSignTimeMs: number
}

export type DashboardActivityDay = {
  /** ISO date (YYYY-MM-DD), local server time. */
  date: string
  sent: number
  completed: number
}

export type DashboardStatusBucket = {
  status: EnvelopeStatus
  count: number
}

export type DashboardResult = {
  stats: DashboardStats
  activity: DashboardActivityDay[]
  statusDistribution: DashboardStatusBucket[]
  recent: EnvelopeListItem[]
}

const ACTIVITY_DAYS = 14
const AVG_SAMPLE_SIZE = 200

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

/**
 * One-shot dashboard payload. Server does every aggregation (status buckets,
 * recent rows, 14-day activity, avg sign time) so the page can render with
 * a single fetch and zero client-side math.
 */
export async function getDashboard(caller: Caller): Promise<DashboardResult> {
  const scope: Prisma.EnvelopeWhereInput =
    caller.role === Role.ADMIN ? {} : { createdById: caller.id }

  const today = startOfDay(new Date())
  const activityStart = new Date(today)
  activityStart.setDate(activityStart.getDate() - (ACTIVITY_DAYS - 1))

  // The three findMany calls go through one transaction so they read a
  // consistent snapshot. groupBy has a different type signature inside
  // $transaction, so we run it separately — accepting a tiny race window
  // (the bucket counts can drift by one if an envelope is created mid-flight).
  const [recentRows, activityRows, avgSamples] = await prisma.$transaction([
    prisma.envelope.findMany({
      where: scope,
      include: ENVELOPE_INCLUDE,
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    prisma.envelope.findMany({
      where: {
        ...scope,
        OR: [
          { sentAt: { gte: activityStart } },
          { completedAt: { gte: activityStart } },
        ],
      },
      select: { sentAt: true, completedAt: true },
    }),
    prisma.envelope.findMany({
      where: {
        ...scope,
        status: "completed",
        sentAt: { not: null },
        completedAt: { not: null },
      },
      select: { sentAt: true, completedAt: true },
      orderBy: { completedAt: "desc" },
      take: AVG_SAMPLE_SIZE,
    }),
  ])

  const groups = await prisma.envelope.groupBy({
    by: ["status"],
    where: scope,
    _count: { _all: true },
  })

  // Stats + status distribution from the groupBy result.
  let total = 0
  let drafts = 0
  let awaiting = 0
  let completed = 0
  const statusDistribution: DashboardStatusBucket[] = []
  for (const g of groups) {
    const count = g._count._all
    statusDistribution.push({ status: g.status, count })
    total += count
    if (g.status === "draft") drafts += count
    else if (g.status === "sent" || g.status === "partially_signed")
      awaiting += count
    else if (g.status === "completed") completed += count
  }
  const sentTotal = total - drafts
  const completionRate =
    sentTotal > 0 ? Math.round((completed / sentTotal) * 100) : 0

  // Average sign time: mean of (completedAt - sentAt) over a sample.
  const avgSignTimeMs =
    avgSamples.length === 0
      ? 0
      : avgSamples.reduce(
          (acc, e) =>
            acc + (e.completedAt!.getTime() - e.sentAt!.getTime()),
          0
        ) / avgSamples.length

  // 14-day activity buckets, oldest first.
  const days: DashboardActivityDay[] = []
  for (let i = 0; i < ACTIVITY_DAYS; i++) {
    const day = new Date(activityStart)
    day.setDate(day.getDate() + i)
    const next = new Date(day)
    next.setDate(next.getDate() + 1)
    let sent = 0
    let dayCompleted = 0
    for (const row of activityRows) {
      if (row.sentAt && row.sentAt >= day && row.sentAt < next) sent++
      if (
        row.completedAt &&
        row.completedAt >= day &&
        row.completedAt < next
      )
        dayCompleted++
    }
    days.push({
      // ISO local date (YYYY-MM-DD)
      date: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
      sent,
      completed: dayCompleted,
    })
  }

  return {
    stats: {
      total,
      drafts,
      awaiting,
      completed,
      completionRate,
      avgSignTimeMs,
    },
    activity: days,
    statusDistribution,
    recent: recentRows.map(serializeEnvelopeListItem),
  }
}
