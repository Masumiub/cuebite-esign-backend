import { Role, type TemplateCategory } from "@prisma/client"

import { prisma } from "../db/prisma.js"
import {
  bufferToBase64,
  dataUrlToBuffer,
  readPdfFile,
  removeTemplateFiles,
  writeTemplateDocument,
} from "../storage/files.js"
import { ForbiddenError, NotFoundError } from "../utils/errors.js"

export type Caller = { id: string; role: Role }

const publicSelect = {
  id: true,
  name: true,
  description: true,
  category: true,
  iconKey: true,
  documentName: true,
  pageCount: true,
  byteSize: true,
  usageCount: true,
  lastUsedAt: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
} as const

/** Sort templates so the most-used + most-recent float to the top. */
export async function listTemplates() {
  return prisma.template.findMany({
    orderBy: [{ lastUsedAt: "desc" }, { updatedAt: "desc" }],
    select: publicSelect,
  })
}

export async function getTemplate(id: string) {
  const t = await prisma.template.findUnique({
    where: { id },
    select: publicSelect,
  })
  if (!t) throw new NotFoundError("Template not found")
  return t
}

export type CreateTemplateInput = {
  name: string
  description: string
  category: TemplateCategory
  iconKey?: string
  documentName: string
  pageCount: number
  /** Either a `data:application/pdf;base64,…` URL or raw base64. */
  contentBase64: string
}

/**
 * Create a template row, then write its PDF to disk. If the file write
 * fails we roll the row back so we never leave a template pointing to
 * nothing.
 */
export async function createTemplate(caller: Caller, input: CreateTemplateInput) {
  const created = await prisma.template.create({
    data: {
      name: input.name,
      description: input.description,
      category: input.category,
      iconKey: input.iconKey ?? "file-signature",
      documentName: input.documentName,
      pageCount: input.pageCount,
      createdById: caller.id,
    },
    select: publicSelect,
  })

  try {
    const buf = dataUrlToBuffer(input.contentBase64)
    const { storagePath, byteSize } = await writeTemplateDocument(
      created.id,
      buf
    )
    return prisma.template.update({
      where: { id: created.id },
      data: { storagePath, byteSize },
      select: publicSelect,
    })
  } catch (err) {
    await prisma.template.delete({ where: { id: created.id } })
    await removeTemplateFiles(created.id)
    throw err
  }
}

/** Only the creator or an admin may delete a template. */
export async function deleteTemplate(caller: Caller, id: string) {
  const template = await prisma.template.findUnique({
    where: { id },
    select: { id: true, createdById: true },
  })
  if (!template) throw new NotFoundError("Template not found")
  if (
    caller.role !== Role.ADMIN &&
    template.createdById !== null &&
    template.createdById !== caller.id
  ) {
    throw new ForbiddenError()
  }
  await prisma.template.delete({ where: { id } })
  await removeTemplateFiles(id)
}

/**
 * Returns the template + its PDF as base64 so the wizard can pre-load it.
 * Also bumps `usageCount` and refreshes `lastUsedAt` so the list can show
 * "Last used 2 days ago" honestly.
 */
export async function useTemplate(id: string) {
  const t = await prisma.template.findUnique({ where: { id } })
  if (!t) throw new NotFoundError("Template not found")
  if (!t.storagePath) {
    throw new NotFoundError("Template has no document attached")
  }
  const buf = await readPdfFile(t.storagePath)
  const updated = await prisma.template.update({
    where: { id },
    data: {
      usageCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
    select: publicSelect,
  })
  return {
    template: updated,
    contentBase64: `data:application/pdf;base64,${bufferToBase64(buf)}`,
  }
}
