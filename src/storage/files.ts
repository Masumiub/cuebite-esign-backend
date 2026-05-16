import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { env } from "../config/env.js"

/**
 * All PDF bytes live in a single private Supabase Storage bucket. Keys mirror
 * the layout we used when files lived on local disk, so `storagePath` values
 * stored in the database remain valid:
 *
 *   <envelopeId>/document-<documentId>.pdf
 *   <envelopeId>/signed.pdf
 *   templates/<templateId>/document.pdf
 *
 * Only this file talks to Supabase Storage — services call the same exported
 * functions as before (`writeDocument`, `readPdfFile`, ...).
 */

const BUCKET = env.SUPABASE_STORAGE_BUCKET

let _client: SupabaseClient | null = null
function client(): SupabaseClient {
  if (_client) return _client
  _client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
  return _client
}

/**
 * Fail fast at boot if the bucket is misconfigured or unreachable. A `list`
 * on the root with limit 1 is the cheapest call that exercises both auth and
 * the bucket existence.
 */
export async function ensureUploadsDir(): Promise<void> {
  const { error } = await client().storage.from(BUCKET).list("", { limit: 1 })
  if (error) {
    throw new Error(
      `Supabase Storage bucket "${BUCKET}" is not reachable: ${error.message}`
    )
  }
}

/**
 * Convert `data:application/pdf;base64,xxxx` (or raw base64) into a Buffer.
 * Throws if the input isn't valid base64.
 */
export function dataUrlToBuffer(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:[^;]+;base64,(.*)$/)
  const b64 = match && match[1] ? match[1] : dataUrl
  return Buffer.from(b64, "base64")
}

export function bufferToBase64(buf: Buffer): string {
  return buf.toString("base64")
}

/**
 * Reject any key that tries to escape the bucket's logical scope. Supabase
 * keys are just strings, but if a path ever bubbles up from user input we
 * don't want `../` or absolute paths to slip through.
 */
function assertSafeKey(key: string): void {
  if (
    key.length === 0 ||
    key.startsWith("/") ||
    key.includes("..") ||
    key.includes("\\")
  ) {
    throw new Error("Refusing to access storage key outside scope")
  }
}

async function uploadPdf(
  key: string,
  bytes: Buffer
): Promise<{ storagePath: string; byteSize: number }> {
  assertSafeKey(key)
  const { error } = await client()
    .storage.from(BUCKET)
    .upload(key, bytes, {
      contentType: "application/pdf",
      upsert: true,
    })
  if (error) {
    throw new Error(`Supabase upload failed for ${key}: ${error.message}`)
  }
  return { storagePath: key, byteSize: bytes.length }
}

export async function writeDocument(
  envelopeId: string,
  documentId: string,
  bytes: Buffer
): Promise<{ storagePath: string; byteSize: number }> {
  return uploadPdf(`${envelopeId}/document-${documentId}.pdf`, bytes)
}

export async function readPdfFile(storagePath: string): Promise<Buffer> {
  assertSafeKey(storagePath)
  const { data, error } = await client()
    .storage.from(BUCKET)
    .download(storagePath)
  if (error || !data) {
    throw new Error(
      `Supabase download failed for ${storagePath}: ${error?.message ?? "no data"}`
    )
  }
  return Buffer.from(await data.arrayBuffer())
}

export async function writeSignedPdf(
  envelopeId: string,
  bytes: Buffer
): Promise<{ storagePath: string; byteSize: number }> {
  return uploadPdf(`${envelopeId}/signed.pdf`, bytes)
}

/**
 * Supabase has no "rm -rf prefix" primitive — list everything under the prefix
 * and pass the explicit keys to `.remove()`. Our layout is flat (no nested
 * folders under an envelope or template), so a single `list` covers it.
 */
async function removePrefix(prefix: string): Promise<void> {
  assertSafeKey(prefix)
  const { data, error } = await client()
    .storage.from(BUCKET)
    .list(prefix, { limit: 1000 })
  if (error) {
    throw new Error(`Supabase list failed for ${prefix}: ${error.message}`)
  }
  const keys = (data ?? [])
    // Folder entries come back with `id: null`; we only want real objects.
    .filter((e) => e.id !== null)
    .map((e) => `${prefix}/${e.name}`)
  if (keys.length === 0) return
  const { error: rmError } = await client().storage.from(BUCKET).remove(keys)
  if (rmError) {
    throw new Error(`Supabase remove failed for ${prefix}: ${rmError.message}`)
  }
}

export async function removeEnvelopeFiles(envelopeId: string): Promise<void> {
  await removePrefix(envelopeId)
}

// ---- templates ------------------------------------------------------------

export async function writeTemplateDocument(
  templateId: string,
  bytes: Buffer
): Promise<{ storagePath: string; byteSize: number }> {
  return uploadPdf(`templates/${templateId}/document.pdf`, bytes)
}

export async function removeTemplateFiles(templateId: string): Promise<void> {
  await removePrefix(`templates/${templateId}`)
}
