import dns from "node:dns"

// Prefer IPv4 for all outbound DNS lookups. Some hosts (Render free, certain
// Vercel egress paths) don't support outbound IPv6, and Node's default returns
// AAAA records first → SMTP sends, Supabase REST calls, etc. fail with
// ENETUNREACH until the connection times out.
dns.setDefaultResultOrder("ipv4first")

import cookieParser from "cookie-parser"
import cors from "cors"
import express from "express"

import { env } from "./config/env.js"
import { attachUser } from "./middleware/auth.js"
import { errorHandler, notFoundHandler } from "./middleware/error.js"
import { authRouter } from "./routes/auth.routes.js"
import { envelopesRouter } from "./routes/envelopes.routes.js"
import { signingRouter } from "./routes/signing.routes.js"
import { smtpRouter } from "./routes/smtp.routes.js"
import { templatesRouter } from "./routes/templates.routes.js"
import { usersRouter } from "./routes/users.routes.js"

export const app = express()

// Bumped to allow PDF uploads (data URLs blow past the default 100kb fast).
// Note: on Vercel Hobby the platform caps request bodies at 4.5 MB regardless
// of what we set here — PDFs larger than ~3 MB raw will fail at the edge.
app.use(express.json({ limit: "50mb" }))
app.use(cookieParser())
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  })
)
app.use(attachUser)

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "cuebites-esign-backend" })
})

app.use("/auth", authRouter)
app.use("/envelopes", envelopesRouter)
app.use("/sign", signingRouter)
app.use("/smtp", smtpRouter)
app.use("/templates", templatesRouter)
app.use("/users", usersRouter)

app.use(notFoundHandler)
app.use(errorHandler)
