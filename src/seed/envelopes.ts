import type { PrismaClient } from "@prisma/client"

const COLORS = [
  "#2563eb", // blue
  "#16a34a", // green
  "#d97706", // amber
  "#9333ea", // purple
  "#dc2626", // red
  "#0891b2", // cyan
]
function color(i: number): string {
  return COLORS[i % COLORS.length]!
}

/**
 * Insert the four demo envelopes owned by `ownerId`. Returns the inserted ids.
 * Existing rows with the same `id` are skipped (this is meant to be idempotent
 * across re-runs of the seed script).
 */
export async function seedDemoEnvelopes(
  prisma: PrismaClient,
  ownerId: string
): Promise<string[]> {
  const created: string[] = []

  const draft = await prisma.envelope.upsert({
    where: { id: "env_demo_draft" },
    update: {},
    create: {
      id: "env_demo_draft",
      createdById: ownerId,
      subject: "Q3 Vendor NDA — Acme",
      message: "Quick NDA before we share the spec. Sign anytime this week.",
      status: "draft",
      routingMode: "sequential",
      createdAt: new Date("2026-05-08T15:21:00.000Z"),
      updatedAt: new Date("2026-05-08T15:21:00.000Z"),
      documents: {
        create: [{ name: "Acme NDA.pdf", pageCount: 3 }],
      },
      recipients: {
        create: [
          {
            name: "Jordan Lee",
            email: "jordan@acme.com",
            color: color(0),
            order: 1,
            status: "pending",
          },
        ],
      },
      audits: {
        create: [
          {
            at: new Date("2026-05-08T15:21:00.000Z"),
            message: "Envelope created.",
          },
        ],
      },
    },
  })
  created.push(draft.id)

  const sentEnv = await prisma.envelope.upsert({
    where: { id: "env_demo_sent" },
    update: {},
    create: {
      id: "env_demo_sent",
      createdById: ownerId,
      subject: "Office Lease — Level 4 Renewal",
      message:
        "Renewal of the level-4 lease for another 12 months. Please review the new annex.",
      status: "sent",
      routingMode: "sequential",
      sentAt: new Date("2026-05-06T09:00:00.000Z"),
      createdAt: new Date("2026-05-05T17:00:00.000Z"),
      updatedAt: new Date("2026-05-07T11:40:00.000Z"),
      documents: {
        create: [{ name: "Lease Renewal 2026.pdf", pageCount: 12 }],
      },
      recipients: {
        create: [
          {
            name: "Priya Shah",
            email: "priya.shah@northstar.co",
            color: color(1),
            order: 1,
            status: "signed",
            signedAt: new Date("2026-05-07T11:40:00.000Z"),
          },
          {
            name: "Ben Carter",
            email: "ben@northstar.co",
            color: color(2),
            order: 2,
            status: "sent",
          },
        ],
      },
      audits: {
        create: [
          {
            at: new Date("2026-05-06T09:00:00.000Z"),
            message: "Sent to Priya Shah.",
          },
          {
            at: new Date("2026-05-07T11:40:00.000Z"),
            message: "Priya Shah signed.",
          },
        ],
      },
    },
  })
  created.push(sentEnv.id)

  const completeEnv = await prisma.envelope.upsert({
    where: { id: "env_demo_complete" },
    update: {},
    create: {
      id: "env_demo_complete",
      createdById: ownerId,
      subject: "Employment Agreement — Sam Chen",
      message: "Welcome aboard! Sign your offer here.",
      status: "completed",
      routingMode: "sequential",
      sentAt: new Date("2026-04-30T08:00:00.000Z"),
      completedAt: new Date("2026-05-01T10:42:00.000Z"),
      createdAt: new Date("2026-04-29T19:00:00.000Z"),
      updatedAt: new Date("2026-05-01T10:42:00.000Z"),
      documents: {
        create: [{ name: "Sam Chen — Offer.pdf", pageCount: 6 }],
      },
      recipients: {
        create: [
          {
            name: "Sam Chen",
            email: "sam.chen@example.com",
            color: color(3),
            order: 1,
            status: "signed",
            signedAt: new Date("2026-05-01T10:14:00.000Z"),
          },
          {
            name: "Md Masum",
            email: "digital@cuebites.com.au",
            color: color(4),
            order: 2,
            status: "signed",
            signedAt: new Date("2026-05-01T10:42:00.000Z"),
          },
        ],
      },
      audits: {
        create: [
          {
            at: new Date("2026-04-30T08:00:00.000Z"),
            message: "Sent to Sam Chen.",
          },
          {
            at: new Date("2026-05-01T10:14:00.000Z"),
            message: "Sam Chen signed.",
          },
          {
            at: new Date("2026-05-01T10:42:00.000Z"),
            message: "Md Masum countersigned. Envelope completed.",
          },
        ],
      },
    },
  })
  created.push(completeEnv.id)

  const declinedEnv = await prisma.envelope.upsert({
    where: { id: "env_demo_declined" },
    update: {},
    create: {
      id: "env_demo_declined",
      createdById: ownerId,
      subject: "Marketing Services SOW — Q2",
      message: "Statement of work for the Q2 retainer.",
      status: "declined",
      routingMode: "parallel",
      sentAt: new Date("2026-05-02T13:00:00.000Z"),
      createdAt: new Date("2026-05-02T12:30:00.000Z"),
      updatedAt: new Date("2026-05-03T09:12:00.000Z"),
      documents: {
        create: [{ name: "Q2 SOW.pdf", pageCount: 5 }],
      },
      recipients: {
        create: [
          {
            name: "Avery Park",
            email: "avery@bluerise.studio",
            color: color(5),
            order: 1,
            status: "declined",
          },
        ],
      },
      audits: {
        create: [
          {
            at: new Date("2026-05-02T13:00:00.000Z"),
            message: "Sent to Avery Park.",
          },
          {
            at: new Date("2026-05-03T09:12:00.000Z"),
            message: "Avery Park declined: 'Pricing terms need revision.'",
          },
        ],
      },
    },
  })
  created.push(declinedEnv.id)

  return created
}
