import crypto from "node:crypto"
import { env } from "../config/env.js"

const ALGO = "aes-256-gcm"
const IV_LENGTH = 12 // 96-bit IV is the GCM recommendation
const TAG_LENGTH = 16

function getKey(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, "hex")
}

/**
 * Encrypts a UTF-8 string with AES-256-GCM.
 * Returns a single base64 token containing iv || authTag || ciphertext.
 *
 * Use only for secrets the server needs to USE later (e.g. SMTP password).
 * For login passwords use a hash via utils/password.ts instead.
 */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv)
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString("base64")
}

/** Reverses encryptSecret. Throws if the ciphertext was tampered with. */
export function decryptSecret(token: string): string {
  const buf = Buffer.from(token, "base64")
  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Ciphertext is too short to be valid")
  }
  const iv = buf.subarray(0, IV_LENGTH)
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH)
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8")
}
