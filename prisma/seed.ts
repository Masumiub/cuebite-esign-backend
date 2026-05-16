/// <reference types="node" />
import { PrismaClient, Role } from "@prisma/client"
import bcrypt from "bcryptjs"

import { seedDemoEnvelopes } from "../src/seed/envelopes.js"

const db = new PrismaClient()

async function main() {
  const passwordHash = await bcrypt.hash("admin123", 12)

  const admin = await db.user.upsert({
    where: { email: "admin@example.com" },
    update: {
      name: "Admin",
      role: Role.ADMIN,
      passwordHash,
    },
    create: {
      email: "admin@example.com",
      name: "Admin",
      role: Role.ADMIN,
      passwordHash,
    },
  })

  console.log(
    `Seeded admin user: ${admin.email} / admin123 (role=${admin.role})`
  )

  const envelopeIds = await seedDemoEnvelopes(db, admin.id)
  console.log(`Seeded ${envelopeIds.length} demo envelopes:`)
  for (const id of envelopeIds) console.log(`  · ${id}`)
}

main()
  .then(async () => {
    await db.$disconnect()
  })
  .catch(async (err) => {
    console.error("Seed failed:", err)
    await db.$disconnect()
    process.exit(1)
  })
