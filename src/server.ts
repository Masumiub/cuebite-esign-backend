import { app } from "./app.js"
import { env } from "./config/env.js"
import { ensureUploadsDir } from "./storage/files.js"

// Verify the Supabase Storage bucket is reachable at boot. Only meaningful
// for the long-running local dev server — on serverless the check runs
// lazily when a storage operation first happens.
ensureUploadsDir().catch((err) => {
  console.error("[cuebites-esign-backend] storage bucket unreachable:", err)
  process.exit(1)
})

app.listen(env.PORT, () => {
  console.log(
    `[cuebites-esign-backend] listening on http://localhost:${env.PORT}`
  )
  console.log(`[cuebites-esign-backend] CORS_ORIGIN=${env.CORS_ORIGIN}`)
})
