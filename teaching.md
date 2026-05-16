# Cuebites eSign Backend — Teaching Guide

A friendly walkthrough of the backend we built. Read top to bottom for the
mental model, or jump to the section you need. Every concept is grounded in
the actual code you can open.

---

## 1. The 60-second mental model

We built a separate API server. It does three jobs:

1. **Talks to Postgres** through Prisma (an ORM).
2. **Owns user identity** — passwords, sessions, roles.
3. **Serves HTTP endpoints** (`/auth/login`, `/auth/me`, etc.) the Next.js
   frontend calls.

The browser stores a tiny "I'm logged in" token in a cookie. On every request,
the cookie rides along automatically. The API reads the cookie, checks who
you are, and decides whether you're allowed.

```
┌───────────────┐    fetch("/auth/me",                ┌────────────────┐
│  Browser      │ ─── credentials: "include") ─────►  │  Express API   │
│  (Next.js)    │ ◄─── { user: { ... } } ───────────  │  :4000         │
└───────────────┘                                     │      │         │
       ▲                                              │      ▼         │
       │ cookie: cb_session=<JWT>                     │  Prisma → PG   │
       └──────────────────────────────────────────────┘                │
                                                      └────────────────┘
```

That cookie is the whole secret. If it's valid the API trusts you; if not,
you get a 401.

---

## 2. The toolbox (and why each one)

Open `backend/package.json` and you'll see these dependencies. In plain words:

| Package           | What it does                                                |
| ----------------- | ----------------------------------------------------------- |
| `express`         | The HTTP framework. Routes + middleware.                   |
| `cors`            | Lets the browser at `:3000` call the API at `:4000`.       |
| `cookie-parser`   | Reads cookies off incoming requests into `req.cookies`.    |
| `bcryptjs`        | Turns a plain password into a one-way hash.                |
| `jsonwebtoken`    | Signs and verifies JWTs (our session tokens).              |
| `@prisma/client`  | The query API generated from our database schema.          |
| `prisma`          | CLI: migrations, generate, seed.                           |
| `zod`             | Validates env vars and request bodies at runtime.          |
| `dotenv`          | Loads `.env` into `process.env`.                           |
| `tsx`             | Runs TypeScript directly in dev (watch mode).              |

Mental shortcut: Express + Prisma + bcrypt + jsonwebtoken is the *classic*
Node auth stack. Everything else is glue.

---

## 3. Big concepts (read these once, the code makes sense after)

### 3.1 The request lifecycle

Every HTTP request to Express runs through a *pipeline*. Middleware are just
functions in that pipeline. Each one can:

- read or change the request,
- short-circuit and send a response,
- or call `next()` to pass control to the next function.

```
Request ──► json parser ──► cookie parser ──► CORS ──► attachUser ──► route ──► response
            (middleware)    (middleware)      (mw)     (mw)            handler
```

If middleware #3 sends `res.status(401).json(...)`, the chain stops. The
route handler never runs. This is exactly how `requireAuth` and `requireRole`
work.

### 3.2 Authentication vs Authorization

Two words that sound similar, mean different things:

- **Authentication** ("who are you?"): you prove your identity. Logging in
  with email + password.
- **Authorization** ("are you allowed?"): given who you are, can you do this
  action? Our roles (`ADMIN` / `MANAGER` / `EMPLOYEE`) are about authorization.

A logged-in employee is *authenticated* but *not authorized* to create new
users. That's why `requireRole(ADMIN)` returns 403 (Forbidden), not 401
(Unauthorized).

### 3.3 Password hashing with bcrypt

We **never** store passwords. We store a *hash* — a one-way scramble.

Why? If our database leaks tomorrow, the attacker only gets hashes, not real
passwords. They can't reverse a hash. They'd have to guess passwords and
re-hash them to compare — which bcrypt makes painfully slow on purpose.

Two important properties of bcrypt:

- **Salt**: a random per-password value mixed in before hashing. So two
  users with the same password get different hashes.
- **Work factor / rounds**: how slow the hash is. We use `12` rounds. That
  means roughly 2^12 = 4096 internal iterations. Slow for an attacker,
  invisible to a real user (one login = one hash).

```ts
// utils/password.ts (simplified)
import bcrypt from "bcryptjs"
const hash = await bcrypt.hash("admin123", 12)
// → "$2a$12$Xy.....abc"
const ok = await bcrypt.compare("admin123", hash)  // true
```

The `$2a$12$` prefix encodes the algorithm, rounds, and salt — so we don't
need a separate "salt" column in the database. Just store the hash string.

### 3.4 JWT (JSON Web Token) — the part to really understand

A JWT is a **signed JSON object**. Three parts joined by dots:

```
HEADER.PAYLOAD.SIGNATURE
```

Decoded, the parts look like:

```json
HEADER:    { "alg": "HS256", "typ": "JWT" }
PAYLOAD:   { "sub": "user_123", "email": "admin@example.com",
             "role": "ADMIN", "iat": 1715567890, "exp": 1716172690 }
SIGNATURE: HMAC_SHA256(base64(header) + "." + base64(payload), JWT_SECRET)
```

Key facts:

1. **It's not encrypted.** The payload is base64-encoded JSON. Anyone can
   read it — paste a JWT into [jwt.io](https://jwt.io) and you'll see the
   email and role. **Never put secrets in the payload.**

2. **It's signed.** Only somebody who knows `JWT_SECRET` can produce a valid
   signature. So if a JWT verifies, we know *we* (or someone with our
   secret) created it. The token is *tamper-evident* — change one character
   and the signature won't match anymore.

3. **It's stateless.** We don't store sessions in the database. The token
   itself carries the user id + role. The server only needs `JWT_SECRET` to
   trust it. (Trade-off: we can't easily revoke an individual session.
   That's why we set a 7-day expiry.)

The flow when you log in:

```
  email/password ──► server checks bcrypt ──► server signs JWT:
                                                jwt.sign({sub, email, role},
                                                         JWT_SECRET,
                                                         {expiresIn: "7d"})
                                              ──► JWT goes in a cookie
```

The flow on later requests:

```
  cookie cb_session=<JWT> ──► server runs jwt.verify(token, JWT_SECRET)
                              ──► gets back { sub, email, role }
                              ──► sets req.user = { id, email, role }
```

If `jwt.verify` throws (bad signature, expired, malformed), we treat the
request as anonymous.

### 3.5 Why an httpOnly cookie, not localStorage?

There are two common places to keep a session token: `localStorage` or a
cookie. We picked cookies for one big reason: **`httpOnly` cookies cannot
be read by JavaScript**.

| Storage         | Sent automatically? | Readable by JS?  | XSS risk            |
| --------------- | ------------------- | ---------------- | ------------------- |
| `localStorage`  | No — you must add a header | Yes        | Token stealable     |
| httpOnly cookie | Yes — browser attaches it | **No**       | Token *not* stealable |

XSS = "cross-site scripting" — if a bug lets attacker JS run on your page
(say, via a malicious third-party script), localStorage tokens are toast.
HttpOnly cookies survive that.

The other flags we set:

- `secure: true` (production) → only sent over HTTPS.
- `sameSite: "lax"` → only sent on same-site requests + top-level
  navigations. Blocks most cross-site request forgery (CSRF).
- `path: "/"` → sent for every URL on our API.
- `maxAge: 7 days` → matches the JWT expiry.

Why `SameSite=Lax` works for us: `localhost:3000` and `localhost:4000` share
the same *site* (`localhost`), so Lax cookies cross between them. In
production, if your frontend and API live on different sites entirely,
you'd switch to `SameSite=None` (with `Secure=true`).

### 3.6 CORS (Cross-Origin Resource Sharing)

The browser refuses to send a `fetch` from `:3000` to `:4000` unless the
server says it's OK. CORS is the server's way of saying yes. Our config:

```ts
cors({
  origin: env.CORS_ORIGIN,  // "http://localhost:3000"
  credentials: true,         // allow cookies on cross-origin requests
})
```

`credentials: true` plus `fetch(..., { credentials: "include" })` on the
frontend is the magic combo that lets cookies cross between ports.

### 3.7 Prisma — the ORM

Prisma turns this schema:

```prisma
model User {
  id           String  @id @default(cuid())
  email        String  @unique
  passwordHash String
  role         Role
  ...
}
```

into a fully typed client. So when you write `prisma.user.findUnique(...)`,
TypeScript knows every field name, every type, and autocompletes everything.

Workflow:

1. Edit `prisma/schema.prisma`
2. `npm run db:migrate -- --name <name>` — generates a SQL migration and
   applies it
3. `npm run db:generate` — regenerates the typed client (migrate does this
   automatically too)
4. Use `prisma` in code

### 3.8 Zod — runtime validation

TypeScript checks types *at compile time*. But the moment a JSON body
arrives over the wire, TypeScript can't help — that's runtime data. Zod
fills the gap:

```ts
const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
})

// throws ZodError if body is bad; our error middleware turns it into 400
const { email, password } = loginSchema.parse(req.body)
```

We also use Zod to validate environment variables at startup — so the
process refuses to boot if `.env` is misconfigured. That's
`src/config/env.ts`.

---

## 4. The files, top to bottom

### `prisma/schema.prisma` — the data model

Defines the `User` table and the `Role` enum (`ADMIN | MANAGER | EMPLOYEE`).
The `@@index([role])` helps with future queries like "all admins". `cuid()`
generates compact, sortable IDs.

### `prisma/seed.ts` — the starter admin

Runs once with `npm run db:seed`. Uses `upsert` (update if exists, create
otherwise) so re-running is safe. Creates `admin@example.com` with
`bcrypt.hash("admin123", 12)` and role `ADMIN`.

```ts
await db.user.upsert({
  where: { email: "admin@example.com" },
  update: { ... },
  create: { ... },
})
```

### `src/config/env.ts` — load and validate env

Reads `.env`, hands it to a Zod schema, exits with a readable error if
anything's missing. Exports a `env` object that's typed (e.g. `env.PORT` is
`number`, `env.COOKIE_SAMESITE` is `"lax" | "strict" | "none"`).

Key trick: **fail fast on misconfig**. Better to die at boot than serve
a broken API with mysterious 500s.

### `src/db/prisma.ts` — singleton client

```ts
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
export const prisma = globalForPrisma.prisma ?? new PrismaClient(...)
if (env !== "production") globalForPrisma.prisma = prisma
```

Why the `globalThis` dance? In dev with hot reload, you'd otherwise spawn a
new PrismaClient on every file change and exhaust the database's connection
pool. Stashing it on `globalThis` survives module reloads. Classic pattern.

### `src/utils/password.ts` — hash + verify

Thin wrapper around `bcryptjs`. Two functions: `hashPassword(plain)` and
`verifyPassword(plain, hashed)`. Centralized so we can change the rounds in
one place.

### `src/utils/jwt.ts` — sign + verify

```ts
export type SessionPayload = { sub: string; email: string; role: Role }

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_TTL })
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET)
    // narrow + return shape
  } catch {
    return null    // expired, tampered, malformed — all "not valid"
  }
}
```

`sub` is JWT convention for "subject" (the user id). `iat`/`exp` (issued-at,
expires-at) are added automatically by `jsonwebtoken`.

### `src/utils/cookie.ts` — set + clear

Two helpers that always use the same flags. `setSessionCookie(res, token)`
on login; `clearSessionCookie(res)` on logout or invalid session. They both
read `COOKIE_NAME`, `COOKIE_SECURE`, `COOKIE_SAMESITE` from env so production
can override.

### `src/middleware/auth.ts` — three pieces

#### `attachUser`

Runs on **every** request via `app.use(attachUser)`. Job: read the cookie,
verify the JWT, and populate `req.user` if valid. It never *blocks* the
request — it just enriches it. Anonymous requests just have `req.user =
undefined`.

```ts
export function attachUser(req, _res, next) {
  const token = req.cookies?.[env.COOKIE_NAME]
  if (token) {
    const session = verifySession(token)
    if (session) {
      req.user = { id: session.sub, email: session.email, role: session.role }
    }
  }
  next()
}
```

#### `requireAuth`

A *route-level* middleware. If `req.user` isn't set, returns 401 and stops.
Otherwise calls `next()`. Use it on any route that needs a logged-in user.

#### `requireRole(...roles)`

A *middleware factory*: it returns a middleware. That's the only way to
parameterize a middleware. `requireRole(Role.ADMIN, Role.MANAGER)` returns a
function that says "must be ADMIN or MANAGER, else 403".

The pattern:

```ts
router.get("/admin-thing", requireAuth, requireRole(Role.ADMIN), handler)
//                          ↑ checks identity   ↑ checks role      ↑ runs only if both pass
```

Order matters. `requireAuth` first sets `req.user`; `requireRole` reads it.

### `src/middleware/error.ts` — last-resort catcher

Express calls error middleware (`(err, req, res, next)` — note the **4
args**) whenever a handler throws or calls `next(error)`. We:

- Turn `ZodError` into a clean 400 with field-level details.
- Log everything else and return a 500.

Without this, a thrown error would crash the process or hang the request.

### `src/routes/auth.ts` — the actual auth endpoints

The meat of this whole file. Four routes:

**`POST /login`**

1. `loginSchema.parse(req.body)` — validate shape.
2. `prisma.user.findUnique({ where: { email } })` — look up.
3. `verifyPassword(password, user.passwordHash)` — compare.
4. `signSession({ sub: user.id, email, role })` — make a JWT.
5. `setSessionCookie(res, token)` — attach cookie.
6. `res.json({ user })` — return public user fields (never the hash).

Important: when login fails we always say "Invalid email or password" — we
don't say "no such email" vs "wrong password". That prevents *user
enumeration* (where attackers learn which emails exist on the system).

**`POST /logout`**

Trivial: `clearSessionCookie(res)`. Returns `{ ok: true }`.

**`GET /me`**

Guarded by `requireAuth`. Looks up the user fresh from the DB (so role
changes apply immediately, not when the next token rotates) and returns
public fields. If the user was deleted but the JWT is still valid, we clear
the cookie and 401.

**`POST /register`**

Guarded by `requireAuth` **and** `requireRole(Role.ADMIN)`. Only admins can
create new users (any role).

### `src/routes/users.ts` — listing users

One endpoint: `GET /users`, guarded by `requireAuth` and
`requireRole(Role.ADMIN, Role.MANAGER)`. Selects only safe fields (no
`passwordHash`) — a classic mistake is forgetting that and leaking it.

### `src/types/express.d.ts` — TypeScript ambient declaration

```ts
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; role: Role }
    }
  }
}
export {}
```

This tells TypeScript: "the Express `Request` type also has an optional
`user` property". Without it, `req.user` would be a red squiggly. We never
*use* this file — it's purely a type augmentation. The empty `export {}`
makes it a module so the `declare global` works.

### `src/server.ts` — the entrypoint

Wires everything together in a specific order:

```ts
app.use(express.json({ limit: "1mb" }))   // 1. parse JSON bodies
app.use(cookieParser())                    // 2. parse Cookie header
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }))  // 3. CORS
app.use(attachUser)                        // 4. set req.user from cookie
app.get("/health", ...)                    // 5. liveness probe
app.use("/auth", authRouter)               // 6. mount routers
app.use("/users", usersRouter)
app.use(notFoundHandler)                   // 7. 404
app.use(errorHandler)                      // 8. error catcher
app.listen(env.PORT, ...)
```

**Order matters a lot.** If you put `cookieParser` after `attachUser`, the
cookies wouldn't be parsed yet. If `errorHandler` weren't last, it would be
skipped.

---

## 5. Three flows, end to end

### Flow A — Successful login

```
Browser                    Express                   Postgres
   │                          │                         │
   │  POST /auth/login        │                         │
   │  { email, password }     │                         │
   │ ────────────────────────►│                         │
   │                          │  parse body (zod)       │
   │                          │  findUnique(email) ────►│
   │                          │ ◄──── user row ─────────│
   │                          │  bcrypt.compare(pwd,    │
   │                          │     user.passwordHash)  │
   │                          │  jwt.sign({sub,role})   │
   │                          │  Set-Cookie:            │
   │                          │    cb_session=<JWT>     │
   │ ◄── 200 { user } ────────│                         │
   │                          │                         │
```

The browser keeps the cookie. Every later request from `:3000` to `:4000`
includes it automatically (because of `credentials: "include"` on the
frontend and `credentials: true` in CORS).

### Flow B — Loading the dashboard

```
Browser                                Express
   │                                      │
   │  GET /auth/me  (cookie attached)     │
   │ ────────────────────────────────────►│
   │                                      │  cookieParser → req.cookies
   │                                      │  attachUser → jwt.verify
   │                                      │             → req.user = {...}
   │                                      │  requireAuth → passes
   │                                      │  prisma.user.findUnique(id)
   │  ◄── 200 { user } ───────────────────│
```

The same dance happens for **every** authenticated request. The JWT
sometimes expires — when that happens, `verifySession` returns `null`,
`req.user` stays `undefined`, `requireAuth` returns 401, and the frontend
bounces you to `/login`.

### Flow C — Employee tries to create a user

```
Browser                                Express
   │                                      │
   │  POST /auth/register  (cookie)       │
   │ ────────────────────────────────────►│
   │                                      │  attachUser → req.user.role = EMPLOYEE
   │                                      │  requireAuth → passes
   │                                      │  requireRole(ADMIN) → 403 Forbidden
   │  ◄── 403 ────────────────────────────│
   │                                      │
                                       (handler never runs;
                                        no DB write happens)
```

The middleware chain is doing exactly what middleware are good at:
short-circuiting before the expensive work.

---

## 6. Why this matters in the real world

A few non-obvious choices we made and why:

- **`Invalid email or password` for both wrong-email and wrong-password.**
  Prevents user enumeration.
- **`SameSite=Lax` by default.** Blocks most CSRF. If we ever switch to
  `None` we'd need an explicit CSRF strategy.
- **Hash rounds = 12.** Roughly 250 ms per hash on modern hardware. Slow
  enough to deter brute force, fast enough not to feel sluggish.
- **JWT expiry 7 days, not 1 hour + refresh token.** We chose simplicity
  for the prototype. Production usually pairs a short-lived access token
  with a longer-lived refresh token.
- **`select` only safe fields in queries.** Easy to forget. If you ever
  return the raw `User`, the `passwordHash` will go out the door.
- **Roles on the user, not on a permissions table.** Simple, but means
  changing what `MANAGER` can do is a code change, not a config change.
  Fine for three roles, not great if you grow to twenty.

---

## 7. Common follow-up questions

**Q: Can I revoke a JWT?**

Not directly — that's the trade-off of stateless tokens. You can:

- Wait for it to expire.
- Rotate `JWT_SECRET` (invalidates every token at once).
- Keep a "revocation list" or "session table" in the DB and check it on
  every request (then you have *most* of a real session anyway).

**Q: What if someone steals the cookie?**

`httpOnly` blocks JS from reading it. `Secure` blocks it from being sent
over plain HTTP. `SameSite=Lax` blocks most cross-site request forgery.
The remaining risks are physical access to the browser, or a
machine-in-the-middle on HTTP. HTTPS in production closes that.

**Q: Why bcryptjs, not bcrypt?**

`bcrypt` (the binary one) is faster but needs native compilation, which
breaks installs on a lot of laptops. `bcryptjs` is a pure-JS reimplementation
— a touch slower but always installs. For our scale, the difference is
nothing.

**Q: Why a separate Express server instead of Next.js API routes?**

Two reasons: (1) it isolates the long-running database client from the
frontend's hot-reload cycle, and (2) it scales independently — you can put
the API on its own machine later without moving the frontend.

---

## 8. Quick reference: the auth promises

If you remember nothing else, remember this table — it tells you exactly
what's enforced where.

| Promise                                    | Where it's enforced              |
| ------------------------------------------ | -------------------------------- |
| "Passwords are never stored in plaintext"  | `utils/password.ts` (bcrypt)    |
| "Tokens can't be tampered with"            | `utils/jwt.ts` (jwt.verify)     |
| "Sessions expire"                          | `signSession` `expiresIn`        |
| "Anonymous users can't see protected data" | `middleware/auth.ts` `requireAuth` |
| "Employees can't act as admins"            | `middleware/auth.ts` `requireRole` |
| "Browsers from other origins are blocked"  | `server.ts` `cors({ origin })`  |
| "Bad input gets a clean 400, not a 500"    | `middleware/error.ts` (Zod)     |
| "Env misconfig fails at boot"              | `config/env.ts` (Zod)           |

Open the file next to each promise. The whole system is six small files of
glue around very well-known patterns. You can read them all in one sitting
now that you know what each piece is for.

---

# Part 2 — Putting SMTP config in the database

Earlier we let admins type SMTP credentials into a form that lived in the
browser's `localStorage`. That was fine for a prototype, but it had three
real problems:

1. **Per-device.** Sign in from another browser and the SMTP config is gone.
2. **Per-user.** Two admins can't share one mail server.
3. **The password sat in plain text inside the browser**, where any
   third-party script on the page can read it.

So we moved the SMTP config into Postgres. The frontend never sees the
password again after it's saved.

## 9. The shape of the change

```
   Before                                After

   Browser localStorage                   Postgres ┌──────────────────┐
       │                                           │ SmtpConfig       │
       │ smtp config                               │  id = "default"  │
       │                                           │  passwordEncryp… │  ← AES-256-GCM
       ▼                                           └──────────────────┘
   Next.js API route                                       ▲
   (gets creds in request body)                            │
       │                                                   │
       ▼                                          Express  /smtp routes
   nodemailer.sendMail(...)                       (decrypts in memory,
                                                   then nodemailer)
```

Two important consequences:

- The Settings page now **POSTs** the password to the backend instead of
  saving it locally. The backend encrypts it before storing.
- The wizard ("Send envelope") and the signing page ("email signed PDF")
  no longer carry SMTP creds in their requests. They just say "send these
  emails, please" and the backend pulls the creds from the DB.

## 10. The new concepts

### 10.1 The singleton-row pattern

We want **at most one** SMTP config in the whole app. There are a few ways
to enforce that:

- A `Settings` table where each row is a key/value pair (`smtp_host`, `smtp_port`, …).
  Flexible but you lose typed columns.
- A `SmtpConfig` table with a `unique` boolean column. Hacky.
- **A table whose primary key has a fixed default value.** Cleanest.

We picked the third option:

```prisma
model SmtpConfig {
  id  String  @id @default("default")
  ...
}
```

Every write upserts the row with `id = "default"`. Because `id` is the
primary key, you can't have two of them.

```ts
await prisma.smtpConfig.upsert({
  where: { id: "default" },
  create: { id: "default", ... },
  update: { ... },
})
```

If we later need *per-user* SMTP, we add a `userId` column and replace the
sentinel with `where: { userId }`. No data loss.

### 10.2 Hashing vs encryption — and why SMTP is the second one

For login passwords we used **hashing** (`bcrypt`):

> hash = one-way scramble. We never need the original back; we only need to
> answer "does this typed password match the stored hash?".

For SMTP passwords we need **encryption**:

> encrypt = two-way scramble with a key. We have to recover the *real*
> password because we have to hand it to the mail server.

Wrong tool comparison:

| Use case            | Tool       | Why                                            |
| ------------------- | ---------- | ---------------------------------------------- |
| Login password      | `bcrypt`   | We only ever compare. One-way is safer.       |
| SMTP password       | AES-GCM    | We have to use the actual value later.        |
| API token sent by client | n/a   | Don't store it; treat it as ephemeral.        |

### 10.3 AES-256-GCM — what we used

GCM stands for "Galois/Counter Mode". It's an *authenticated* cipher: it
both encrypts and produces a "tag" that proves the ciphertext wasn't
modified. Three inputs and three outputs:

```
inputs  → key (32 bytes), iv (12 bytes random, unique per encryption),
          plaintext
outputs → ciphertext, authTag (16 bytes)
```

The IV ("initialization vector") must be **unique** for each encryption.
We generate a fresh random one every time. If you reuse an IV with the same
key, GCM's security collapses entirely.

We pack everything into one base64 string so the database column stays
simple:

```
storedToken = base64( iv || authTag || ciphertext )
```

`||` here is byte-concatenation. On decryption we split the buffer back
apart in the same order.

You can read the actual code in [`src/utils/crypto.ts`](src/utils/crypto.ts).
About 30 lines, no library — just Node's built-in `crypto` module.

### 10.4 The encryption key — where it lives

The key has to be 32 bytes (256 bits). We store it in `.env` as 64 hex
chars and validate it at boot:

```env
ENCRYPTION_KEY=  # generate with: openssl rand -hex 32
```

Zod rejects anything that isn't `^[0-9a-fA-F]{64}$` so the process refuses
to start if it's malformed. Same fail-fast principle as `JWT_SECRET`.

**If you ever lose the key, you lose access to every encrypted secret.**
There's no recovery — that's the entire point. In production you keep the
key in a secrets manager (AWS KMS, GCP Secret Manager, Vault) and rotate it
with a re-encryption step.

### 10.5 "Password set" instead of "password value"

A subtle UX choice: when an admin opens Settings to **edit** SMTP, what
should the password field show?

- Show the decrypted password? **No.** Anyone with the admin's session
  cookie would see it. It also re-introduces the localStorage problem.
- Show empty? Confusing — "did the password get erased?"
- Show a placeholder + a boolean flag. ✓

So our GET endpoint returns this:

```json
{
  "configured": true,
  "config": {
    "host": "smtp.gmail.com",
    "port": 465,
    "user": "you@gmail.com",
    "fromName": "Cuebites eSign",
    "fromEmail": "you@gmail.com",
    "passwordSet": true       // ← the password itself never leaves the server
  }
}
```

The form treats an empty password as "keep the current one":

```ts
if (parsed.password && parsed.password.length > 0) {
  passwordEncrypted = encryptSecret(parsed.password)
} else if (existing) {
  passwordEncrypted = existing.passwordEncrypted     // reuse
} else {
  return res.status(400).json({ error: "Password is required on first save." })
}
```

Result: admins can edit the From-name without touching the password.

## 11. The new files

### `src/utils/crypto.ts`

Three functions: `encryptSecret(plain) → token`, `decryptSecret(token) →
plain`, and an internal `getKey()` that reads the env var. Anything we want
encrypted at rest goes through these.

### `src/services/smtp.ts`

This is the *mailing* layer. Pure functions, no Express, no Prisma — just
"given a runtime config and a payload, send some emails". Splitting it out
means the route file stays focused on HTTP and authz; the service file
focuses on email content + transport.

Three functions:

- `sendTest(config, to)` — uses `transporter.verify()` first so a bad
  password fails immediately, then sends one confirmation email.
- `sendSigningEmails(config, { subject, message, senderName, targets })` —
  loops the targets, renders the "Review and sign" HTML/text, collects
  per-recipient success/failure.
- `sendCompletedEmails(config, { subject, senderName, targets, attachment })` —
  same idea but with a signed PDF attached.

Templates are inline HTML strings with all user-supplied content
HTML-escaped. The signed-PDF attachment accepts either a raw base64 string
or a full `data:application/pdf;base64,...` data URL; we strip the prefix
if it's there.

### `src/routes/smtp.ts`

The HTTP surface. Five routes:

| Method | Path                   | Auth        | What it does                          |
| ------ | ---------------------- | ----------- | ------------------------------------- |
| GET    | `/smtp`                | ADMIN       | Return current config (no password) + a `configured` boolean |
| PUT    | `/smtp`                | ADMIN       | Upsert config; password optional on update |
| DELETE | `/smtp`                | ADMIN       | Forget the row                        |
| POST   | `/smtp/test`           | ADMIN       | Send a test mail (uses draft from body, or saved config) |
| POST   | `/smtp/send-signing`   | any logged-in | Email signing links to recipients   |
| POST   | `/smtp/send-completed` | none (public) | Email the fully-signed PDF       |

Two of those auth choices are worth pausing on:

**Why is `/smtp/send-signing` open to *any* logged-in user, not admins?**

Because anyone authorized to **create an envelope** should be allowed to
*send* it. The privileged operation is *configuring* SMTP, not *using* it.
We don't want every regular user pestering an admin to send their NDA.

**Why is `/smtp/send-completed` public (no auth at all)?**

Because the signing flow is anonymous. The recipient who just finished
signing has no cookie. They need to trigger the "send everyone the signed
PDF" email. We accept this trust trade-off because (a) the only data
attacker can leak is "yes, SMTP is configured" or "yes, this PDF was
emailed", and (b) the SMTP creds themselves never leave the server. In a
real product we'd verify the signing token (envelope id + recipient id)
inside this route before allowing the send.

Each route uses the same Zod schemas at the top of the file to validate
input. A bad request gets a clean `400` from our error middleware.

### Schema migration

The migration that introduced this table was created with:

```bash
npx prisma migrate dev --name add_smtp_config
```

Prisma generated a SQL file in `prisma/migrations/...` and applied it.
The TypeScript types were regenerated by `npx prisma generate` so
`prisma.smtpConfig.*` is now fully typed.

## 12. The new frontend pieces

### `src/lib/smtp-store.ts`

Replaces the old localStorage Zustand store. The store now only caches what
the server says is true:

```ts
type SmtpState = {
  hydrated: boolean        // have we asked the server yet?
  configured: boolean      // does a config exist?
  config: SmtpConfigPublic | null   // everything except the password
  hydrate(): Promise<void>           // GET /smtp
  save(input): Promise<...>          // PUT /smtp
  clear(): Promise<void>             // DELETE /smtp
  sendTest(to, override?): Promise<void>             // POST /smtp/test
  sendSigning(payload): Promise<{sent, failed}>      // POST /smtp/send-signing
  sendCompleted(payload): Promise<{sent, failed}>    // POST /smtp/send-completed
}
```

There's an in-flight dedup so repeat `hydrate()` calls only fire one
request. Same pattern we use for the auth store.

### Settings page

Two new behaviours:

- On mount, it calls `hydrate()` so the form auto-fills from the database.
- The password input is **optional on update**. The placeholder reads
  `•••••••• (unchanged)`. If you leave it blank, the existing password is
  kept; if you type a new one, it's encrypted and saved.

### Wizard "Send envelope"

Used to read the full SMTP config from the store and POST it to a Next.js
API route. Now it just calls `useSmtp.sendSigning({ subject, message,
senderName, targets })` and the backend handles credentials.

### Public signing page

When the last recipient submits, the page tries to email a signed PDF copy
to everyone via `useSmtp.sendCompleted(...)`. If the backend says "no SMTP
configured" (400), we swallow that quietly — the signed PDF is still saved
locally. Any other error shows a yellow warning toast.

### What got deleted

The whole `frontend/src/app/api/send-signing/route.ts` file is gone. That
was the old Next.js API route that received the SMTP creds in its body
and called `nodemailer`. The backend now owns that responsibility.

## 13. End-to-end flow with screenshots-in-words

### A. Admin saves SMTP for the first time

```
Admin opens /settings ─► Settings calls useSmtp.hydrate()
                            ─► GET /smtp ─► 200 { configured: false, config: null }
                            ─► form is blank

Admin fills host/port/user/password/from-email
Admin clicks Save SMTP ─► useSmtp.save({...})
                          ─► PUT /smtp { ..., password: "abcd efgh ijkl mnop" }
                          ─► Server: parsed = configSchema.parse(body)
                          ─► passwordEncrypted = encryptSecret("abcd...")
                          ─► prisma.smtpConfig.upsert({ id: "default", ... })
                          ─► 200 { configured: true, config: {... passwordSet: true} }
                          ─► Store updates, form clears the password field
                          ─► Toast: "SMTP saved"
```

### B. Sender creates an envelope and emails recipients

```
User finishes the wizard, clicks Send envelope.
Frontend builds: targets = recipients.map(...{name, email, link: ".../sign/<token>"})

useSmtp.sendSigning({ subject, message, senderName, targets })
  ─► POST /smtp/send-signing { ...targets }     (cookie attached automatically)
  ─► attachUser → requireAuth → handler
  ─► const runtime = await loadRuntimeConfig()
       which reads the row and decryptSecret(passwordEncrypted)
  ─► nodemailer creates transporter, sends one email per target
  ─► 200 { ok: true, sent: 3, failed: 0 }
Frontend shows: "Emailed signing link to 3 recipients"
```

### C. Last recipient finishes, signed PDF goes out

```
Recipient submits the last required field.
Frontend builds the signed PDF locally (pdf-lib in the browser),
then sends it as base64.

useSmtp.sendCompleted({ subject, targets, attachment: { filename, contentBase64 }})
  ─► POST /smtp/send-completed
  ─► (no auth required for this route)
  ─► loadRuntimeConfig() decrypts password
  ─► nodemailer.sendMail({ attachments: [{filename, content: Buffer.from(b64,'base64')}] })
  ─► 200 { sent, failed }
Frontend shows: "Signed copy emailed to N recipients"
```

## 14. Why each design choice, in one sentence each

- **Singleton row keyed on `id="default"`.** Lets us upsert without juggling
  count constraints, and the table can naturally grow into per-user later.
- **AES-256-GCM, not just AES-CBC.** GCM is authenticated — we detect
  tampering instead of silently decrypting garbage.
- **Random 12-byte IV per encryption.** Reusing an IV under the same key
  breaks GCM completely.
- **`encryptSecret`/`decryptSecret` instead of inline `crypto.createCipher…`
  calls.** Centralizes the key handling and makes it trivial to swap for
  KMS later.
- **`passwordSet: boolean` in the GET response.** Lets the UI know there's
  a stored password without ever leaking it.
- **Empty password on update means "don't change".** Standard pattern from
  every CMS you've ever used; admins don't have to retype it to edit other
  fields.
- **Send routes split (`/test`, `/send-signing`, `/send-completed`)** rather
  than one big "send" endpoint with a mode flag. Each has its own
  validation, its own auth requirement, and its own template. Easier to
  evolve in isolation.
- **Service file separate from route file.** Lets the templates be tested
  without spinning up Express, and lets us reuse the templates from a
  background job later (e.g., daily reminder emails).
- **Validation with Zod inside the route file**, not the service. Routes
  are the only ones that see raw HTTP — the service trusts what it gets.

## 15. Updated security promises

The auth promises table from Part 1 still holds. Add these:

| Promise                                              | Where it's enforced                |
| ---------------------------------------------------- | ---------------------------------- |
| "SMTP passwords are never stored in plain text"      | `utils/crypto.ts` (encryptSecret)  |
| "Only admins can change SMTP settings"               | `requireRole(ADMIN)` on the routes |
| "Anyone with the secret key can decrypt — protect it"| `.env` `ENCRYPTION_KEY`            |
| "The browser never sees the SMTP password after save"| GET `/smtp` returns `passwordSet` only |
| "A bad SMTP test fails fast"                         | `transporter.verify()` before sending |

If you remember nothing else: **hash login passwords, encrypt SMTP
passwords, never send either back over the wire**.

---

# Part 3 — Envelopes: from localStorage to Postgres + disk

Earlier the entire envelope list (subjects, recipients, fields, audit log,
signed PDFs) lived in the browser's `localStorage`. That meant:

- Two browsers = two parallel "demos". Anything Alice created, Bob couldn't
  see.
- A page refresh that lost the in-memory blob URL meant the PDF disappeared.
- The signing flow worked because everything ran in one tab — not because
  there was a real backend behind it.

This pass made envelopes real:

```
   Before                                  After

   Browser localStorage                    Postgres ┌───────────────────┐
       │                                            │ Envelope          │
       │  envelopes[]                               │   recipients      │
       │  fieldValues                               │   fields (.value) │
       │  signedPdfs                                │   audits          │
       ▼                                            │   signedPdf       │
   useEnvelopes (Zustand)                           └───────────────────┘
                                                            +
                                                  backend/uploads/<id>/
                                                    document-<docId>.pdf
                                                    signed.pdf
                                                            ▲
                                                            │
                                                  Express   /envelopes
                                                            /sign/:token
```

## 16. Two new ideas

### 16.1 Files belong on disk, references belong in the database

The schema only stores **metadata** about the PDFs — a `storagePath` (a path
relative to `backend/uploads/`) and a `byteSize`. The actual bytes go to
disk through `storage/files.ts`. There are good reasons for this:

- Postgres rows have a soft size limit (TOAST). Storing 25-50MB PDFs in
  every row makes simple queries (e.g. "give me the envelope list") much
  slower because the DB has to drag every byte off disk and through the
  network.
- Backups and restores are simpler with a "everything in DB" model, but
  much more expensive at our PDF sizes. With files-on-disk we can rsync the
  uploads folder separately, or swap it for S3 later without touching the
  schema.

The trade-off: **disk and DB can drift**. If we delete a row but forget to
remove the file, the file becomes an orphan. Our `removeEnvelopeFiles()`
helper runs whenever an envelope is deleted, but in a real product you'd
add a periodic reconciliation job to sweep orphans.

The directory layout is per-envelope:

```
uploads/
└── <envelopeId>/
    ├── document-<docId>.pdf
    └── signed.pdf                (created when the envelope completes)
```

One folder per envelope keeps `ls` readable in dev and makes `rm -rf` on
delete trivially correct.

### 16.2 Public token-scoped endpoints

Most endpoints sit under `/envelopes/*` and require a logged-in cookie.
But the recipient signing flow is anonymous — recipients don't have a
Cuebites account. We solve that with a second router at `/sign/:token`
where `token = "<envelopeId>--<recipientId>"`.

Each route inside that router:

1. Parses the token.
2. Loads the envelope + recipient as a pair (404 if either is missing).
3. Performs exactly the action the recipient is allowed to do (record
   consent, fill one of *their* fields, finish their own signing).

```ts
// routes/signing.ts (simplified)
async function loadByToken(token: string) {
  const { envelopeId, recipientId } = parseToken(token)
  const envelope = await prisma.envelope.findUnique({ where: { id: envelopeId }, ... })
  const recipient = envelope?.recipients.find((r) => r.id === recipientId)
  return envelope && recipient ? { envelope, recipient } : null
}
```

The "field value" endpoint is the most defensive — it re-checks
`field.recipientId === recipient.id` to stop a recipient from filling
another signer's fields:

```ts
if (field.recipientId !== loaded.recipient.id) {
  return res.status(403).json({ error: "Belongs to another recipient" })
}
```

The token is **not yet signed** — anyone who can guess the
`<envelopeId>--<recipientId>` pair can sign. Cuid ids are 25 random
characters, so guessing is impractical, but in production the right
upgrade is to swap the token for a short-lived signed JWT.

## 17. The data model

All seven Envelope tables in one breath:

| Model                  | Holds                                                                       |
| ---------------------- | --------------------------------------------------------------------------- |
| `Envelope`             | Subject, message, status (`draft / sent / partially_signed / completed / declined / voided / expired`), routing, timestamps, `createdById` FK. |
| `EnvelopeDocument`     | One row per uploaded PDF. Stores `name`, `pageCount`, `storagePath`, `byteSize`. |
| `EnvelopeRecipient`    | Name + email + colour + order. Tracks `status`, `consentAt`, `signedAt`, and the adopted `signatureDataUrl` / `initialDataUrl`. |
| `EnvelopeField`        | One row per placeable field. Stores type, page, position as fractions (`x/y/width/height ∈ 0..1`), `recipientId`, and the eventual `value`. |
| `EnvelopeAudit`        | Append-only timeline. `at`, free-form `actorId`, `message`. Reading the audit log = sorting by `at`. |
| `EnvelopeSignedPdf`    | 1:1 with `Envelope`. Filled the moment the last recipient finishes — bytes on disk, metadata here. |
| `User.envelopes`       | Reverse relation so admins can list "all envelopes I created". |

Every child relation uses `onDelete: Cascade` so deleting an envelope
removes its recipients, fields, audits, and signed-PDF row in one
statement. We then call `removeEnvelopeFiles(envelopeId)` to delete the
folder on disk.

`createdById` uses `onDelete: SetNull` instead — if a user account is
removed, their envelopes survive (you don't want a leaving employee's
deletion to nuke open contracts).

## 18. The endpoints, in one table

| Method | Path                                  | Auth                  | What it does                                       |
| ------ | ------------------------------------- | --------------------- | -------------------------------------------------- |
| GET    | `/envelopes`                          | session               | List envelopes the caller owns (admins see all). Slim — no audit/fields. |
| GET    | `/envelopes/:id`                      | session + creator/admin | Full envelope with recipients, fields, fieldValues, audit. No PDF bytes. |
| GET    | `/envelopes/:id/documents/:docId`     | session + creator/admin | The original PDF as `{ name, pageCount, contentBase64 }`. |
| GET    | `/envelopes/:id/signed-pdf`           | session + creator/admin | The flattened signed PDF as `{ filename, contentBase64 }`. |
| POST   | `/envelopes`                          | session               | Create + send. Body carries `documents[].contentBase64`; the server writes files and updates rows in a transaction. |
| DELETE | `/envelopes/:id`                      | session + creator/admin | Remove envelope (cascade) and the on-disk folder. |
| POST   | `/envelopes/:id/void`                 | session + creator/admin | Status → `voided`, audit entry. Rejects if already completed/voided. |
| POST   | `/envelopes/reset-demo`               | ADMIN                 | Wipes the admin's envelopes and reseeds the four demos. |
| GET    | `/sign/:token`                        | —                     | Envelope + recipient + document base64 for the signing page. |
| POST   | `/sign/:token/consent`                | —                     | Idempotent. Sets `consentAt` + audit. |
| POST   | `/sign/:token/signature`              | —                     | Adopt signature or initial; stored on the recipient row. |
| POST   | `/sign/:token/fields/:fieldId`        | —                     | Set this recipient's value on one of their own fields. |
| POST   | `/sign/:token/finish`                 | —                     | Mark recipient signed. If all signed, flip envelope to `completed` and store the supplied signed PDF on disk. |
| GET    | `/sign/:token/signed-pdf`             | —                     | Recipient downloading their copy. |

### 18.1 Access control (`canAccess` helper)

```ts
function canAccess(user, ownerId) {
  if (user.role === Role.ADMIN) return true
  return ownerId !== null && ownerId === user.id
}
```

It's one line of authorization that every mutating route calls before
running. Admin sees everything; everyone else sees only their own. We
record the creator at write-time and never check it again — keep it
boring.

### 18.2 Why the create payload uses indices

The create endpoint accepts fields like:

```json
{ "recipientIndex": 0, "documentIndex": 0, "type": "signature", ... }
```

The client *doesn't know* the ids the server will mint for the new
recipients and documents. So it ships array positions; the server
generates the row ids, then resolves indices into ids when it inserts the
fields. This avoids a chatty two-round-trip "create envelope → create
recipients → create fields" flow.

## 19. The on-disk storage helper

The whole `storage/files.ts` file is ~70 lines. Two non-obvious bits:

### 19.1 Path traversal protection

```ts
function resolveStoragePath(storagePath: string): string {
  const absolute = path.resolve(UPLOADS_DIR, storagePath)
  const rel = path.relative(UPLOADS_DIR, absolute)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Refusing to read file outside uploads directory")
  }
  return absolute
}
```

Without this, a row whose `storagePath` is `../../../etc/passwd` would
hand the attacker the host's password file. We compute the relative path
from `UPLOADS_DIR` and refuse to read anything that escapes upward. The
DB shouldn't contain such paths today, but defense-in-depth is cheap.

### 19.2 Data-URL stripping

PDF data URLs come in from the client as
`data:application/pdf;base64,<bytes>`. The first call decodes:

```ts
export function dataUrlToBuffer(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:[^;]+;base64,(.*)$/)
  const b64 = match && match[1] ? match[1] : dataUrl
  return Buffer.from(b64, "base64")
}
```

Accepting *both* a real data URL and a bare base64 string means the
callers don't have to remember which one they have. The opposite direction
(`Buffer → base64` for JSON responses) is just `buf.toString("base64")`.

## 20. The TanStack hooks on the frontend

Every endpoint above has a matching hook in
`frontend/src/lib/envelope-queries.ts` or `signing-queries.ts`. The
naming is consistent:

| Hook                          | Endpoint                                  |
| ----------------------------- | ----------------------------------------- |
| `useEnvelopesQuery()`         | `GET /envelopes`                          |
| `useEnvelopeQuery(id)`        | `GET /envelopes/:id`                      |
| `useDocumentContentQuery()`   | `GET /envelopes/:id/documents/:docId`     |
| `useSignedPdfQuery(id)`       | `GET /envelopes/:id/signed-pdf`           |
| `useCreateEnvelopeMutation()` | `POST /envelopes`                         |
| `useDeleteEnvelopeMutation()` | `DELETE /envelopes/:id`                   |
| `useVoidEnvelopeMutation()`   | `POST /envelopes/:id/void`                |
| `useResetDemoMutation()`      | `POST /envelopes/reset-demo`              |
| `useSigningViewQuery(token)`  | `GET /sign/:token`                        |
| `useRecordConsentMutation()`  | `POST /sign/:token/consent`               |
| `useAdoptSignatureMutation()` | `POST /sign/:token/signature`             |
| `useSetFieldValueMutation()`  | `POST /sign/:token/fields/:fieldId`       |
| `useFinishSigningMutation()`  | `POST /sign/:token/finish`                |

### 20.1 Cache keys you should know

```
["envelopes", "list"]                     // dashboard + list page
["envelopes", "detail", id]               // detail page + breadcrumb
["envelopes", "doc", envelopeId, docId]   // PDF bytes
["envelopes", "signed-pdf", envelopeId]   // signed copy bytes
["signing", "view", token]                // anonymous signing view
```

The mutations write through to the right cache keys so consumers see
updates without a refetch:

- Create → set detail cache, invalidate list
- Delete → remove detail cache, invalidate list
- Void → update detail cache, invalidate list
- Consent / signature / fieldValue / finish → patch the
  `["signing","view",token]` cache (sometimes optimistically — see below)

### 20.2 Optimistic updates for field values

When a recipient clicks a checkbox or saves a text field, we update the
cache **before** the network round-trip:

```ts
onMutate: ({ fieldId, value }) => {
  qc.setQueryData(signingKeys.view(token), (prev) => {
    if (!prev) return prev
    return {
      ...prev,
      envelope: {
        ...prev.envelope,
        fieldValues: { ...prev.envelope.fieldValues, [fieldId]: value },
      },
    }
  })
}
```

The progress bar and the field overlay flip instantly. If the server
rejects, we'd roll back; for our endpoints success is the only outcome we
care about, so we keep it lean.

### 20.3 The cascading-render trap, again

The same pattern that bit us with SMTP (a `useEffect` that copied server
state into local form state) **doesn't appear here at all**, because we
read everything through queries directly. The signing page reads
`data?.envelope` straight from the query. No local mirror, no sync
effect, no warning.

## 21. What changed on the frontend (deleted!)

| Deleted file                       | Why                                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/store.ts`                 | The whole Zustand envelopes store — replaced by TanStack hooks pointing at real endpoints.                                        |
| `src/lib/mock-data.ts`             | Seed envelopes now live server-side in `backend/src/seed/envelopes.ts`. The lone helper `pickRecipientColor` moved to its own tiny module. |

`signedPdfDataUrl`, `setSignedPdf`, `recordConsent`, `setRecipientSignature`,
`setFieldValue`, `completeRecipientSigning` — all gone. Each one has a
TanStack mutation now.

## 22. End-to-end flow with the new wiring

### A. Creator sends an envelope

```
Wizard finishes:                Frontend                          Backend
       │                            │                                │
       │  state.document (data URL) │  POST /envelopes               │
       │  + recipients + fields ────┼───────────────────────────────►│
       │                            │                                │  parse + zod
       │                            │                                │  envelope.create({
       │                            │                                │    documents: { create: [...] },
       │                            │                                │    recipients: { create: [...] },
       │                            │                                │    audits: { create: [...] }
       │                            │                                │  })
       │                            │                                │  writeDocument(envelopeId, docId, bytes)
       │                            │                                │  prisma.envelopeDocument.update(storagePath)
       │                            │                                │  insert resolved fields
       │  ◄── { envelope } ─────────┼────────────────────────────────│  (re-fetch with include)
       │                            │                                │
       │  POST /smtp/send-signing   │  ─────────────────────────────►│  loads SMTP config
       │  (with signing links)      │                                │  loops recipients + sends
       │                            │                                │
       │  ──────────────────────────► toast: "Emailed N recipients"
```

### B. Recipient signs

```
Recipient opens /sign/<token>:
  ─► GET /sign/:token  ──► { envelope, recipientId, documentBase64 }
  ─► page renders consent screen
Click "I agree":
  ─► POST /sign/:token/consent  → recipient.consentAt set, audit row
Open signature modal, adopt:
  ─► POST /sign/:token/signature { kind, dataUrl }
Click each field:
  ─► POST /sign/:token/fields/:fieldId { value }    (optimistic UI)
Click Finish:
  ─► (frontend builds the signed PDF with pdf-lib)
  ─► POST /sign/:token/finish { signedPdfBase64 }
        ─► recipient.status = signed, signedAt = now
        ─► if all signed: envelope.status = completed, write signed.pdf
  ─► POST /smtp/send-completed { attachment: { contentBase64 } }
  ─► thank-you screen
```

### C. Sender deletes the envelope later

```
Click Delete in /envelopes:
  ─► DELETE /envelopes/:id
        ─► canAccess check (creator or admin)
        ─► prisma.envelope.delete(...)        // CASCADE cleans children
        ─► removeEnvelopeFiles(id)            // rm -rf uploads/<id>
  ─► TanStack invalidates the list cache → table re-renders without it
```

## 23. Where the seams are (for the next pass)

A few obvious follow-ups, each isolated to one or two files:

- **S3 instead of disk.** Replace the four functions in
  `storage/files.ts` with their S3 equivalents (`PutObject`, `GetObject`,
  `DeleteObject`). Routes don't change.
- **Signed signing tokens.** Swap `parseToken` for a JWT with an `exp`
  claim. The store + dispatch layer is unchanged.
- **Server-side email-on-complete.** Today the frontend sends the signed
  PDF to the SMTP endpoint after `/finish`. Easy to move into the
  `/finish` route itself once we're happy with it.
- **Per-user list scoping with shared inbox.** Right now: each user sees
  their own + admins see all. Adding "team" membership is a single new
  table + one `where` clause.

## 24. Promises updated

Building on the table in Part 1:

| Promise                                              | Where it's enforced                       |
| ---------------------------------------------------- | ----------------------------------------- |
| "Only the creator (or admin) can read an envelope"   | `canAccess()` in `routes/envelopes.ts`    |
| "Files don't outlive the envelope"                   | `removeEnvelopeFiles()` after delete + `onDelete: Cascade` |
| "A recipient can't touch another recipient's field"  | `field.recipientId === recipient.id` check |
| "Anonymous routes still need a valid token pair"     | `parseToken()` + envelope-and-recipient lookup |
| "Path traversal is impossible"                       | `resolveStoragePath()` rejects `..` paths |
| "Signed PDFs are stored once the envelope completes" | `EnvelopeSignedPdf` upsert inside `/finish` |

That's the whole story: a schema with seven tables, a couple of helpers
for files and tokens, fourteen endpoints, and a flat set of TanStack
hooks on the other side. Everything else is glue.

---

# Part 4 — How the backend is organised after the refactor

Earlier the routes were one big file per feature: `routes/auth.ts` carried
the URL, the input validation, the password check, the JWT signing, the
cookie write, and the JSON response — all inline. That works at this size,
but it's hard to read and harder to test.

We split each feature into **three thin layers**:

```
   Express
       │
       ▼
   ┌────────────────┐    "the doorman" — checks the cookie/role,
   │  middleware    │     then either passes the request along
   └────────────────┘     or short-circuits with 401/403
       │
       ▼
   ┌────────────────┐    "the address card" — just the URL + which
   │  routes        │     middleware to run + which controller to call.
   └────────────────┘     No logic.
       │
       ▼
   ┌────────────────┐    "the receptionist" — reads the request body,
   │  controllers   │     validates it with zod, calls the service,
   └────────────────┘     turns the result into a JSON response.
       │
       ▼
   ┌────────────────┐    "the worker" — does the real job: Prisma
   │  services      │     queries, file writes, business rules.
   └────────────────┘     Never sees req/res; throws typed errors.
       │
       ▼
   Postgres + uploads/
```

A request enters at the top, walks down to whichever service does the job,
and the response flows back up. Each layer only knows about the layers
directly next to it.

## 25. `server.ts` — the front door

This is the entry point. It boots Express, wires the middleware pipeline,
mounts the feature routers, and starts listening on a port. **Order in
this file is important** — middleware run in declaration order.

```ts
const app = express()

app.use(express.json({ limit: "50mb" }))   // 1. parse JSON bodies
app.use(cookieParser())                    // 2. parse Cookie header into req.cookies
app.use(cors({                              // 3. allow the frontend origin + cookies
  origin: env.CORS_ORIGIN,
  credentials: true,
}))
app.use(attachUser)                        // 4. read JWT cookie → req.user

app.get("/health", ...)                    // 5. liveness probe (no auth)

app.use("/auth", authRouter)               // 6. feature routers
app.use("/envelopes", envelopesRouter)
app.use("/sign", signingRouter)
app.use("/smtp", smtpRouter)
app.use("/users", usersRouter)

app.use(notFoundHandler)                   // 7. anything unmatched → 404
app.use(errorHandler)                      // 8. anything that threw → JSON error

ensureUploadsDir().catch(...)              // 9. make sure backend/uploads/ exists
app.listen(env.PORT, ...)                  // 10. start serving
```

Why each piece sits where it does:

1. **JSON parser first.** Until this runs, `req.body` is `undefined`. Limit
   is bumped to 50 MB because a PDF as a base64 data URL grows the body
   ~33% past its raw size.
2. **Cookie parser.** Without this, `req.cookies` would be undefined and
   our `attachUser` would never find the session token. It needs to come
   *before* anything that reads cookies.
3. **CORS.** Lets the browser at `http://localhost:3000` call our API at
   `:4000` *and* attach cookies. The `credentials: true` flag is critical —
   without it the browser silently drops cookies on cross-origin requests.
4. **`attachUser` is the only global custom middleware.** It runs on every
   route. It doesn't *enforce* anything; it just decodes the cookie. The
   actual gates (`requireAuth` / `requireRole`) live inside the feature
   routers because not every route needs them — `/health` is open, `/sign/*`
   is public, etc.
5. **Health check** before the routers so it's the fastest possible response.
6. **Feature routers** under their URL prefixes. `authRouter` handles
   everything under `/auth/*`; `envelopesRouter` handles `/envelopes/*`;
   and so on. The router files don't need to know about each other.
7. **404 fallthrough.** If no router matches the URL, this runs.
8. **Error handler.** Always last. Express recognises a middleware as an
   error handler by its **4-argument** signature `(err, req, res, next)`.
   Any `throw` or `next(err)` from anywhere upstream lands here.
9. **`ensureUploadsDir`** is a `mkdir -p backend/uploads/` so the storage
   layer can write files. Crashing on boot is better than crashing on the
   first upload.
10. **`app.listen`** is the only blocking call. The promise above runs
    while the server is starting, so by the time the first request comes
    in, the folder exists.

If you ever feel lost about what runs when, open this file. Every request
goes through this list in order.

## 26. `middleware/auth.ts` — the doorman

Three exports, each tiny but doing a precise job.

### 26.1 `attachUser` — "who are you?"

```ts
export function attachUser(req, _res, next) {
  const token = req.cookies?.[env.COOKIE_NAME]      // 1. read the cookie
  if (typeof token === "string" && token) {
    const session = verifySession(token)            // 2. verify the JWT signature
    if (session) {
      req.user = {                                  // 3. stash on the request
        id: session.sub,
        email: session.email,
        role: session.role,
      }
    }
  }
  next()                                            // 4. always continue
}
```

Three things to notice:

- **It never blocks.** Even with no token, or a tampered token, or an
  expired token, it just calls `next()` and leaves `req.user` undefined.
  Blocking is somebody else's job (`requireAuth`).
- **`req.user` is an "ambient" property.** The TypeScript declaration in
  `src/types/express.d.ts` augments Express's `Request` interface so the
  rest of the codebase can read `req.user` without type errors.
- **No DB call.** It trusts the JWT signature — that's the whole point of
  signed tokens. The actual user row is only fetched if a downstream
  handler needs it (e.g. `authController.me` calls
  `authService.getCurrentUser(req.user.id)`).

### 26.2 `requireAuth` — "you must be logged in"

```ts
export function requireAuth(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" })
    return
  }
  next()
}
```

Reads what `attachUser` populated. If `req.user` is missing, it
short-circuits with 401 — the rest of the chain never runs. Use this on any
route that should refuse anonymous callers.

### 26.3 `requireRole(...roles)` — "you must be in this group"

```ts
export function requireRole(...roles: Role[]) {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" })
      return
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden" })
      return
    }
    next()
  }
}
```

This is a **middleware factory** — it doesn't return a middleware directly;
it returns a function that, when called with `(req, res, next)`, becomes a
middleware. That's the only way to "configure" middleware in Express.

```ts
// Call the factory to get the middleware:
const mw = requireRole(Role.ADMIN, Role.MANAGER)
router.get("/users", requireAuth, mw, handler)
```

We almost always inline the factory call:

```ts
router.get("/users", requireAuth, requireRole(Role.ADMIN, Role.MANAGER), handler)
```

Order matters. `requireRole` *reads* `req.user.role`, so `requireAuth`
must run first (or at least `attachUser`, since the global middleware
already covers that).

**401 vs 403 — the difference matters:**

- 401 Unauthorized = "I don't know who you are, log in"
- 403 Forbidden = "I know who you are, you can't do this"

## 27. `routes/*.routes.ts` — just URLs

These files are the smallest in the codebase. They:

- Create a `Router`
- Map HTTP method + path to a controller method
- Chain the middleware that should run before the controller

That's it. **No body parsing. No DB calls. No business logic.**

```ts
// routes/auth.routes.ts
export const authRouter = Router()

authRouter.post("/login", authController.login)
authRouter.post("/logout", authController.logout)
authRouter.get("/me", requireAuth, authController.me)
authRouter.post(
  "/register",
  requireAuth,
  requireRole(Role.ADMIN),
  authController.register
)
```

Reading this file tells you exactly:

- Which URLs exist
- Which HTTP methods they accept
- Which gates protect them
- Which function actually runs

You should be able to answer "is /auth/register admin-only?" in two
seconds without leaving the file. That's the whole point.

The longer routers (`envelopes`, `signing`, `smtp`) follow the same shape.
Compare them side-by-side and you can see the URL surface of the entire
API without opening any other file.

## 28. `controllers/*.controller.ts` — the translator

A controller's job is to translate between the HTTP world (untyped JSON,
strings everywhere, status codes) and the service world (typed function
calls). Every controller method does the same four-step dance:

```ts
export async function login(req, res, next) {
  try {
    const input = loginSchema.parse(req.body)        // 1. validate
    const { user, token } = await authService.login(input)   // 2. delegate
    setSessionCookie(res, token)                     // 3. respond
    res.json({ user })
  } catch (err) {
    next(err)                                        // 4. forward errors
  }
}
```

### 28.1 Validation with zod

Every endpoint that accepts a body has a zod schema **at the top of the
controller file**. We keep schemas next to the handlers that use them so
you don't have to jump between files to know "what does this endpoint
accept".

```ts
const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
})

// Inside the handler:
const input = loginSchema.parse(req.body)
// `input` is now: { email: string; password: string }
```

If the body fails validation, `.parse()` throws a `ZodError`. The error
middleware (back in `server.ts`) catches it and returns a clean 400 with
field-level details:

```json
{
  "error": "Invalid request",
  "details": {
    "email": ["Invalid email"],
    "password": ["String must contain at least 1 character(s)"]
  }
}
```

You'll never see a 500 because of bad input — zod converts it to 400 for
us.

### 28.2 Delegation to a service

After validation, the controller calls a service function and `await`s the
result. The service signature is typed. The controller doesn't know how
the service does its job, just *what* it returns.

```ts
const { user, token } = await authService.login(input)
```

### 28.3 Shaping the response

Anything HTTP-flavoured (cookies, status codes, JSON envelopes) happens
here, not in the service.

```ts
setSessionCookie(res, token)   // set HTTP cookie header
res.status(201).json({ user })  // status + body
```

If the service threw a `NotFoundError`, the controller doesn't catch it —
it just lets it propagate to the error handler. That's how a Prisma
"envelope doesn't exist" deep inside a service becomes a clean 404 at the
HTTP boundary.

### 28.4 The try/catch around everything

```ts
try { ... } catch (err) { next(err) }
```

Every controller wraps its body in this. Why? Because Express 4 doesn't
auto-catch errors from `async` functions — if you `throw` inside an
`async` handler, the promise rejects, but Express never hears about it
and the request hangs. Calling `next(err)` hands the error to the error
middleware.

### 28.5 Typed Request params

For routes with URL parameters, the handler types the `Request` generic
so `req.params.id` is `string` instead of `string | undefined`:

```ts
type IdParams = { id: string }

export async function get(
  req: Request<IdParams>,
  res: Response,
  next: NextFunction
) {
  const envelope = await envelopesService.getEnvelope(caller(req), req.params.id)
  res.json({ envelope })
}
```

This sidesteps the `noUncheckedIndexedAccess` TypeScript strictness rule
without `!` assertions sprinkled everywhere.

## 29. `services/*.service.ts` — the worker

Services do the actual work: Prisma queries, file I/O, password hashing,
JWT signing, business rules. **They have no idea HTTP exists.** No `req`,
no `res`, no status codes. If something goes wrong, they throw a typed
error (`NotFoundError`, `ForbiddenError`, etc.) and trust someone upstream
to translate.

```ts
// services/auth.service.ts
export async function login(input: LoginInput): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } })
  if (!user) throw new UnauthorizedError("Invalid email or password")
  const ok = await verifyPassword(input.password, user.passwordHash)
  if (!ok) throw new UnauthorizedError("Invalid email or password")

  return {
    user: publicUser(user),
    token: signSession({ sub: user.id, email: user.email, role: user.role }),
  }
}
```

Things worth noticing:

- **Input and output types are explicit.** `LoginInput` and `LoginResult`
  are exported from the file. Anyone calling `authService.login(...)`
  knows what to pass and what they'll get.
- **The same generic "Invalid email or password" message** is returned for
  both unknown-email *and* wrong-password — prevents user enumeration.
  This kind of small security choice lives in the service so it can't be
  accidentally undone by a controller wanting "more specific" errors.
- **`publicUser` strips `passwordHash` before returning.** Internal
  function in the same file. The service never lets the hash escape.
- **Errors are typed, not strings.** `throw new UnauthorizedError(...)`
  carries `status: 401` so the error middleware knows exactly what HTTP
  code to use.

### 29.1 Why split services from controllers at all?

Two practical reasons:

**1. Testability.** A service is a normal function. You can write a unit
test that calls it directly:

```ts
const result = await authService.login({ email: "...", password: "..." })
```

No Express, no supertest, no HTTP. Just typed inputs and outputs.

**2. Reuse.** If we ever need to log a user in from somewhere other than
an HTTP route (a CLI tool, a background job, a websocket handler), we
call the same service function. Controllers are an HTTP-specific shell
around services.

### 29.2 The "throw, don't return" convention

Services don't return `null` for "not found". They `throw new NotFoundError(...)`.
Why?

- It bubbles up automatically. The controller doesn't have to write
  `if (!result) return res.status(404)` for every possible failure mode.
- It keeps service signatures honest: `getEnvelope(...)` returns
  `Envelope`, not `Envelope | null`, which avoids `?.` chains in callers.

The only exception is when "not found" is a normal, expected outcome —
e.g. `getCurrentUser(userId)` returns `User | null` because the
controller treats a missing user as "clear the cookie", not as a 404.

## 30. The supporting layers (`utils/`, `storage/`, `services/*.mailer.ts`, `*.serializer.ts`)

Some helpers don't fit any of the three layers but are shared between
them.

### `utils/errors.ts` — typed errors

Already covered above, but to repeat: `HttpError` and its subclasses are
how services tell the controller "this is a 403". The error middleware in
`middleware/error.ts` translates them into JSON responses. Without this,
every service function would either need to return a tagged union or
controllers would need a huge switch statement.

### `utils/jwt.ts`, `utils/password.ts`, `utils/cookie.ts`, `utils/crypto.ts`

Single-purpose helpers used by services. They contain *zero* business
logic — `signSession({...})` doesn't know what a "user" is, it just signs
a payload with the configured secret. Reusable across features.

### `storage/files.ts` — disk I/O

The PDF storage helper. Services call `writeDocument` / `readPdfFile` /
`removeEnvelopeFiles`. If we ever move to S3, only this file changes.

### `services/*.mailer.ts` — pure email transport

`smtp.mailer.ts` knows how to talk to nodemailer and how to render the
email templates, but **not** where SMTP credentials come from. The
`smtp.service.ts` loads creds from the DB, decrypts them, and hands the
mailer a config object. This is a service-helper-service nest: keeping
"how to send" separate from "what to send" lets us swap providers (e.g.
SendGrid) by writing a new `mailer` file.

### `services/*.serializer.ts` — DB row → JSON shape

Prisma rows are great for queries, but they have JavaScript `Date`
objects, optional nullable fields, and joined relations that the frontend
shouldn't have to think about. `envelopes.serializer.ts` is the contract
between server-side and wire-side shapes:

```ts
function serializeEnvelope(row: EnvelopeRow): EnvelopeFull {
  // Dates → ISO strings
  // null → null (no surprises)
  // nested relations → flat arrays of just the fields the client needs
}
```

Both `envelopes.service.ts` and `signing.service.ts` use it, so the
output shape is identical no matter which endpoint a payload comes from.

## 31. Walkthrough: one request, top to bottom

Let's trace `POST /auth/login` from the browser to the database and back.

```
1. Browser sends:
       POST /auth/login HTTP/1.1
       Content-Type: application/json
       { "email": "admin@example.com", "password": "admin123" }

2. server.ts middleware pipeline runs in order:
   - express.json()      → req.body becomes the parsed object
   - cookieParser()      → req.cookies = {} (no cookie yet — first request)
   - cors()              → adds the right Access-Control headers
   - attachUser          → no token → req.user stays undefined

3. URL "/auth/login" matches app.use("/auth", authRouter)
   Inside authRouter: router.post("/login", authController.login)
   The middleware chain for THIS route is empty — `login` is public.

4. authController.login(req, res, next) runs:
   - loginSchema.parse(req.body)   → returns typed { email, password }
                                     or throws ZodError if shape is wrong
   - authService.login(input)      → call the service

5. authService.login({ email, password }) runs:
   - prisma.user.findUnique(...)   → load the row (or null)
   - if missing → throw new UnauthorizedError("Invalid email or password")
   - verifyPassword(...)           → bcrypt compare
   - if mismatch → throw new UnauthorizedError("Invalid email or password")
   - signSession(...)              → produce a JWT string
   - returns { user, token }

6. Back in authController.login:
   - setSessionCookie(res, token)  → adds Set-Cookie: cb_session=...
   - res.json({ user })            → sends the response body

7. Browser receives:
       HTTP/1.1 200 OK
       Set-Cookie: cb_session=eyJhbGc...; HttpOnly; SameSite=Lax; ...
       Content-Type: application/json
       { "user": { "id": "...", "email": "admin@example.com", ... } }
```

If step 5 threw an error, here's what would happen instead:

```
5. authService.login() throws UnauthorizedError("Invalid email or password")

6. authController.login's try/catch catches it → next(err)

7. Express skips ahead to error middleware (the 4-arg one in server.ts)
   → errorHandler sees `err instanceof HttpError`
   → res.status(401).json({ error: "Invalid email or password" })
```

Nobody in steps 5 or 6 needed to know "this should be a 401" except the
service that defines the error class. The status code travels with the
error type all the way through.

## 32. How to add a new endpoint

A concrete recipe — the same five steps every time.

Say you want `POST /envelopes/:id/remind` (send a nudge email to
unsigned recipients).

1. **Write the service function** in `services/envelopes.service.ts`:
   ```ts
   export async function remindUnsigned(caller, envelopeId) {
     const env = await prisma.envelope.findUnique({ where: { id: envelopeId }, ... })
     if (!env) throw new NotFoundError("Envelope not found")
     assertCanAccess(caller, env.createdById)
     const unsigned = env.recipients.filter((r) => r.status !== "signed")
     // ... call the mailer ...
     return { reminded: unsigned.length }
   }
   ```

2. **Add the controller method** in `controllers/envelopes.controller.ts`:
   ```ts
   export async function remind(
     req: Request<{ id: string }>,
     res: Response,
     next: NextFunction
   ) {
     try {
       const result = await envelopesService.remindUnsigned(caller(req), req.params.id)
       res.json(result)
     } catch (err) { next(err) }
   }
   ```

3. **Wire the route** in `routes/envelopes.routes.ts`:
   ```ts
   envelopesRouter.post("/:id/remind", requireAuth, envelopesController.remind)
   ```

4. **(Frontend)** Add a TanStack mutation that POSTs to the new URL.

5. **Done.** No server.ts change. No error-handling boilerplate. The new
   endpoint inherits the same JSON parsing, CORS, cookies, error handling
   and validation infrastructure.

If any of those steps need you to write something other than
service-or-controller-or-route code, it's a sign something belongs in the
shared helpers (`utils/`, `storage/`, `middleware/`) — not duplicated.

## 33. Mental model in one sentence

> **Routes know URLs. Controllers know HTTP. Services know the business.
> Middleware decides who's allowed in.**

If you remember nothing else, that division alone will tell you which
file to open for any given change.

---

# Part 5 — Searching, filtering, and paginating envelopes

Earlier the `/envelopes` list returned every envelope and the frontend did
all the work — counted statuses for the KPI cards, filtered with tabs,
trimmed for the table. That was fine at 10 envelopes; it gets slow,
inaccurate, and weird at 10,000.

This pass moves *everything that depends on the row set* to the server:

| What | Before | After |
| --- | --- | --- |
| Search | Frontend `.filter()` on the list | Backend `WHERE subject ILIKE %x%` |
| Status filter | Frontend tabs | Query string `?status=draft` |
| Pagination | None — the whole list arrived | Query string `?page=2&limit=10` |
| KPI counts | Frontend `.filter().length` | Backend `groupBy(status)` |

The client just renders what the server says.

## 34. The new response shape

```jsonc
{
  "envelopes": [ /* page rows */ ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 15,        // matching the current filter
    "totalPages": 2,
    "hasNext": true,
    "hasPrev": false
  },
  "stats": {            // unfiltered — same for every page/search
    "total": 15,
    "drafts": 3,
    "awaiting": 7,
    "completed": 5
  }
}
```

Two important ideas baked into this shape:

- **`meta.total` reflects the filter.** It's the count of rows that match
  whatever `search` and `status` filters were applied. Pagination math
  uses this.
- **`stats.total` does not reflect the filter.** It's the total across
  the caller's whole envelope set. That way the KPI cards stay stable
  while the user types in the search box — they're a property of the
  *user*, not of the current view.

If we collapsed both into a single number, either the pagination would
break or the KPI cards would jump around every keystroke. Keeping them
separate is worth one extra DB query.

## 35. The new query string

```
GET /envelopes?search=lease&status=sent,partially_signed&page=2&limit=10
```

- `search` — substring, case-insensitive, max 300 chars.
- `status` — single status (`draft`) or comma-separated list
  (`sent,partially_signed`). Empty/omitted = no status filter.
- `page` — 1-indexed, defaults to 1.
- `limit` — page size, defaults to 10, capped to 100.

`status` accepting a list lets the frontend tabs map cleanly:

| Tab | `status` value |
| --- | --- |
| All | (omitted) |
| Drafts | `draft` |
| Awaiting others | `sent,partially_signed` |
| Completed | `completed` |

## 36. How the backend builds the query

In `services/envelopes.service.ts`, the new `listEnvelopes` function does
three things in order: **scope, filter, paginate** — plus **stats** as a
separate computation.

```ts
// 1. SCOPE: who's allowed to see what
const scope: Prisma.EnvelopeWhereInput =
  caller.role === Role.ADMIN ? {} : { createdById: caller.id }

// 2. FILTER: layered on top of scope, only affects the page list
const where: Prisma.EnvelopeWhereInput = { ...scope }
if (opts.search) where.subject = { contains: opts.search, mode: "insensitive" }
if (opts.statuses?.length) where.status = { in: opts.statuses }

// 3. PAGINATE: count + page rows in one transaction
const [total, rows] = await prisma.$transaction([
  prisma.envelope.count({ where }),
  prisma.envelope.findMany({
    where,
    include: ENVELOPE_INCLUDE,
    orderBy: { updatedAt: "desc" },
    skip: (page - 1) * limit,
    take: limit,
  }),
])

// 4. STATS: groupBy over the un-filtered scope
const stats = await computeStats(scope)
```

A few subtleties:

- **`$transaction([count, findMany])`** runs the two queries together,
  guaranteeing the count and the page rows agree. Without it, somebody
  could create an envelope between the count and the findMany, and you'd
  hand the user `total: 15` but only 10 rows that don't add up.
- **`mode: "insensitive"`** uses Postgres `ILIKE` semantics. Substring
  match, case-insensitive, no full-text index needed. For prototype
  scale that's plenty; production would add a `tsvector` index when the
  table grows past a few thousand rows.
- **`groupBy` runs separately** because Prisma's array-form `$transaction`
  doesn't accept it yet. The race here is harmless: stats might be off by
  one for a millisecond if an envelope is created between the two
  queries, and the KPI card will catch up on the next refresh.

## 37. The frontend pieces

### 37.1 `utils/useDebounce.ts`

```ts
export function useDebounce<T>(value: T, delay = 500): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(handle)
  }, [value, delay])
  return debounced
}
```

What it does: returns a value that lags `delay` ms behind every change.
The search box can `setSearchInput` on every keystroke, but the
*debounced* value (used as the query param) only updates once the user
stops typing.

The `setDebounced` call lives inside `setTimeout`, not synchronously in
the effect body — which is what makes this **not** the cascading-render
anti-pattern we discussed earlier. React only warns about synchronous
setState-in-effect; timer-based ones are exactly what effects are for.

### 37.2 `components/pagination.tsx`

A "dumb" component — it knows nothing about your data, only:

- Current `page` + `totalPages`
- `hasNext` / `hasPrev` (so it can disable arrows without doing math)
- An `onPageChange(page)` callback

It renders prev/next arrows, page numbers with ellipses around the
current one (`1 … 4 5 6 … 12`), and a "Showing X–Y of Z" caption. The
window of visible pages is built by a small helper that always includes
the first + last page and a configurable number of "siblings" around the
current one.

The component never fetches — that's the parent's job. The parent owns
`page` state and passes it to the query hook.

### 37.3 The `/envelopes` page wiring

```tsx
const [tab, setTab] = useState<TabValue>("all")
const [searchInput, setSearchInput] = useState("")
const [page, setPage] = useState(1)
const debouncedSearch = useDebounce(searchInput, 500)

// Reset page to 1 whenever the filter/search changes — using React's
// "compare with previous render" trick to avoid setState-in-effect.
const [prevKey, setPrevKey] = useState(`${tab}|${debouncedSearch}`)
const currentKey = `${tab}|${debouncedSearch}`
if (prevKey !== currentKey) {
  setPrevKey(currentKey)
  setPage(1)
}

const query = useEnvelopesQuery({
  search: debouncedSearch,
  status: TABS.find((t) => t.value === tab)?.status ?? "",
  page,
  limit: 10,
})
```

That's the whole "controller" of the page. The render below it just
reads from `query.data` — KPI cards from `stats`, table rows from
`envelopes`, footer from `meta`.

### 37.4 `placeholderData` keeps the table from flashing

The `useEnvelopesQuery` hook passes `placeholderData: (prev) => prev` to
TanStack Query. That tells the cache "while a new page is being fetched,
keep showing the previous one instead of blanking out". Combined with
`query.isFetching` on the Pagination's `disabled` prop, you get a smooth
"old rows greyed for a beat, new rows appear" feel rather than
"everything → empty → everything else".

## 38. End-to-end: one keystroke

A user types `L` in the search box on `/envelopes`. Here's the chain:

```
1. <Input onChange> → setSearchInput("L")          (re-render with searchInput="L")
2. useDebounce sees value change, schedules setDebounced("L") in 500ms
3. <Pagination> still shows the same page (debouncedSearch hasn't changed yet)
4. User types "ea" — searchInput is now "Lea", but debouncedSearch still ""
   (every keystroke cancels the previous timer and starts a new one)
5. User pauses for 500ms.
6. setDebounced("Lea") fires inside the timer.
7. Component re-renders. `currentKey` is now "all|Lea"; `prevKey` was "all|".
8. The if-check fires: setPrevKey("all|Lea"), setPage(1).
9. useEnvelopesQuery's queryKey changes (params include "Lea") →
   TanStack fires the fetch. The query stays in "isFetching" while keeping
   the previous data on screen.
10. Fetch returns. data updates. Table re-renders with the new rows.
    KPI cards stay the same (server stats are unfiltered).
    Pagination updates with the new meta.total / meta.totalPages.
```

If the user clicks the *Drafts* tab during that flow, `setTab` fires,
`currentKey` becomes `drafts|Lea`, the if-check resets page to 1, the
query re-fires with the new status param. Same machinery, different
inputs.

## 39. Why server-side searching matters here

For a 10-envelope demo it's overkill. But:

- **The wire shrinks.** Without pagination, an account with 5,000
  envelopes would download a 5,000-row JSON on every `/envelopes`
  visit. With `limit=10`, it's always ten rows.
- **The DB is faster, not slower.** Postgres can answer
  `WHERE subject ILIKE '%foo%' LIMIT 10` faster than the frontend can
  filter 5,000 rows in JavaScript, because Postgres is allowed to stop
  reading once it has 10 matches.
- **KPI cards stay honest.** When the client filtered, the KPI
  "Total envelopes" number changed every time someone clicked a tab
  (because it was counting the filtered set). Server stats keep them
  constant.
- **It scales when we add features.** Sort-by-recipient, multi-status
  filter combinations, date range — all of them become "add a `where`
  clause" instead of "fetch everything, filter in JS, hope".

## 40. Promises updated

| Promise                                            | Where                          |
| -------------------------------------------------- | ------------------------------ |
| "Search is case-insensitive substring on subject"  | Service: `contains, mode: "insensitive"` |
| "Filter accepts a CSV of statuses"                 | Controller: `parseStatuses(query.status)` |
| "Page math is consistent with row count"           | `prisma.$transaction([count, findMany])` |
| "KPI cards don't change while filtering"           | `computeStats(scope)` — unfiltered |
| "Page resets when filter/search changes"           | "compare-with-prev-render" trick in `/envelopes` |
| "Table doesn't flash while paging"                 | `placeholderData: (prev) => prev` |

If you remember nothing else: **stats use the scope, list uses the
filter, both end up in one response.**

---

# Part 6 — The dashboard endpoint

The `/envelopes` list page is a *table* — it fetches a slice of the rows
and renders them. The `/dashboard` page is the opposite — it's a
collection of summaries (counts, charts, "recent five") and almost never
shows raw rows.

Treating them the same way meant the dashboard had to ask for a 200-row
page and then *compute* the activity chart, the status pie, and the
"recent five" on the client. That worked, but:

- The wire carried 200 rows the user never saw.
- The activity chart re-computed 14 day-buckets on every render.
- Mutating an envelope only updated KPI cards on the next *list* refetch
  because that's where the stats lived.

This pass gives the dashboard its own endpoint that returns exactly what
the page draws — nothing more, nothing less.

## 41. The new endpoint

```
GET /envelopes/dashboard
```

Auth: any logged-in user. Response:

```jsonc
{
  "stats": {
    "total": 15,
    "drafts": 3,
    "awaiting": 7,
    "completed": 5,
    "completionRate": 42,          // 0-100, integer
    "avgSignTimeMs": 91234567       // ms; frontend formats
  },
  "activity": [
    { "date": "2026-05-01", "sent": 0, "completed": 0 },
    /* … 14 days, oldest first … */
    { "date": "2026-05-14", "sent": 2, "completed": 1 }
  ],
  "statusDistribution": [
    { "status": "draft",     "count": 3 },
    { "status": "sent",      "count": 5 },
    { "status": "completed", "count": 5 },
    /* … only statuses that exist … */
  ],
  "recent": [
    /* 5 most recently updated envelopes, list-item shape */
  ]
}
```

One request, four pre-aggregated pieces. The page does **no** computation
beyond formatting `avgSignTimeMs` into `"3.4d"` or `"7h"`.

## 42. How the service builds it

`services/envelopes.service.ts → getDashboard(caller)` does four queries
in a specific order:

```ts
const scope = caller.role === Role.ADMIN ? {} : { createdById: caller.id }
const today = startOfDay(new Date())
const activityStart = new Date(today)
activityStart.setDate(activityStart.getDate() - 13)   // 14 days inclusive

// Three reads in one transaction so they see a consistent snapshot.
const [recentRows, activityRows, avgSamples] = await prisma.$transaction([
  prisma.envelope.findMany({          // recent 5
    where: scope,
    include: ENVELOPE_INCLUDE,
    orderBy: { updatedAt: "desc" },
    take: 5,
  }),
  prisma.envelope.findMany({          // rows that had activity in the window
    where: {
      ...scope,
      OR: [
        { sentAt: { gte: activityStart } },
        { completedAt: { gte: activityStart } },
      ],
    },
    select: { sentAt: true, completedAt: true },
  }),
  prisma.envelope.findMany({          // up to 200 completed for avg time
    where: { ...scope, status: "completed", sentAt: { not: null }, completedAt: { not: null } },
    select: { sentAt: true, completedAt: true },
    orderBy: { completedAt: "desc" },
    take: 200,
  }),
])

// groupBy lives outside the transaction — Prisma's type signature
// changes when it's nested in an array-form $transaction.
const groups = await prisma.envelope.groupBy({
  by: ["status"],
  where: scope,
  _count: { _all: true },
})
```

Then four small JS reductions:

1. **Stats + status distribution** — single pass over `groups`. Each group
   contributes to `total`, *and* to whichever of `drafts / awaiting /
   completed` matches its status, *and* to the distribution array.
2. **Completion rate** — `Math.round(completed / (total - drafts) * 100)`.
3. **Avg sign time** — mean of `completedAt - sentAt` across `avgSamples`.
4. **Activity buckets** — for each of 14 days, count rows whose `sentAt`
   or `completedAt` falls in the day. Returned oldest-first.

The reductions are O(rows). For the activity window that's at most "rows
created or completed in the last fortnight", which is small even at
production scale. The avg-sign-time query is capped at 200 to bound the
worst case.

### 42.1 Why three findManys instead of one big one

We *could* fetch all the rows once and reduce four times in JS. We don't,
because each query has a different `select`/`where` — the activity rows
only need two timestamps, the recent-5 needs the whole list-item shape,
the avg-time sample only needs the completed envelopes. Sending less
over the wire from Postgres is the cheap win.

### 42.2 The groupBy snapshot drift

The three findManys share one transaction, but `groupBy` runs after.
That means the stats numbers might be off by one if a new envelope is
created in the millisecond between the transaction and the groupBy. For
a dashboard this is fine — the next refetch corrects it. If you ever
need exact consistency, wrap the whole sequence in
`prisma.$transaction(async (tx) => …)` form, which accepts arbitrary
queries inside a single Postgres transaction.

## 43. The frontend hook

```ts
export function useDashboardQuery() {
  return useQuery({
    queryKey: ["envelopes", "dashboard"] as const,
    queryFn: () => api<DashboardResponse>("/envelopes/dashboard"),
    staleTime: 60 * 1000,
  })
}
```

One query, one cache key. Every mutation on envelopes also invalidates
`["envelopes", "dashboard"]` so creating, deleting, or voiding an
envelope re-renders the dashboard within the same TanStack round-trip:

```ts
qc.invalidateQueries({ queryKey: ["envelopes", "list"] })
qc.invalidateQueries({ queryKey: ["envelopes", "dashboard"] })
```

(Or, equivalently, `queryKey: ["envelopes"]` to nuke both — we kept them
explicit so it reads cleanly.)

## 44. The chart components, simplified

Both chart components used to take an `envelopes` prop and *compute* their
bucket data on every render. Now they take pre-aggregated buckets:

```ts
// before:
<ActivityChart envelopes={data.envelopes} />
<StatusDistribution envelopes={data.envelopes} />

// after:
<ActivityChart data={data.activity} />
<StatusDistribution buckets={data.statusDistribution} />
```

The components are no longer responsible for `e.sentAt >= day && e.sentAt
< nextDay` math. They're pure renderers that take a list of buckets,
each a tiny `{ date, sent, completed }` or `{ status, count }`. That
makes them:

- **Cheaper to render** — no per-render filtering of arrays.
- **Storybook-able** — feed any bucket array, see how it draws.
- **Future-proof** — when we move buckets to a tsvector index or a
  materialized view, only the service file changes.

`StatusDistribution` is slightly cleverer than a direct mapping: the
`SEGMENTS` table inside the component lists every possible status with
its colour + label. The component reads `buckets` into a `Map`, then
walks `SEGMENTS` in display order. Missing statuses get count `0` and
are filtered out. New statuses without a `SEGMENTS` entry are ignored
(forward-compatible: if the backend ever invents a `paused` status, the
chart won't blow up).

## 45. What got smaller on the dashboard

| Before | After |
| --- | --- |
| `useEnvelopesQuery({ page: 1, limit: 200 })` (200 rows) | `useDashboardQuery()` (4 small aggregates) |
| `useMemo` computing 5 KPIs + 14 days + status pie + recent slice | Direct property reads |
| `envelopes.filter(...)` x4 inside `useMemo` | Zero |
| Chart components reduce per render | Chart components map per render |

The page file shrank from 88 useful lines (with memos) down to roughly 50
of mostly JSX. Mental model: the dashboard page is now a *view* — the
service is the model.

## 46. End-to-end: opening /dashboard

```
1. Browser navigates → React mounts <DashboardPage />
2. useDashboardQuery() — first call → TanStack fires fetch
3. GET /envelopes/dashboard (cookie attached)
4. server.ts middleware → cors → cookieParser → attachUser
5. envelopesRouter — matches "/dashboard" before "/:id"
6. requireAuth passes (req.user is set)
7. envelopesController.dashboard → envelopesService.getDashboard(caller)
8. Service runs three findManys in $transaction + one groupBy
9. Reduces to { stats, activity, statusDistribution, recent }
10. Controller wraps in res.json(result)
11. Browser receives the payload; TanStack caches at ["envelopes", "dashboard"]
12. React re-renders with `data` populated
13. KPI cards bind to data.stats
14. ActivityChart renders 14 bars from data.activity
15. StatusDistribution paints from data.statusDistribution
16. Recent table renders 5 rows from data.recent
```

No `useMemo`, no client-side filtering, no second fetch. If the user
voids an envelope from the list page two minutes later, TanStack's
invalidation kicks in and the dashboard refetches once — fresh KPIs,
fresh chart, fresh recent list.

## 47. Promises updated

| Promise                                                | Where                                  |
| ------------------------------------------------------ | -------------------------------------- |
| "Dashboard fetches its data in one request"            | `useDashboardQuery` + `getDashboard`   |
| "Chart components don't compute, they render"          | Activity/StatusDistribution prop shape |
| "Mutating an envelope refreshes the dashboard"         | `invalidateQueries(["envelopes", "dashboard"])` in every mutation |
| "Stats reflect the caller's whole envelope scope"      | `where: scope` in groupBy              |
| "Avg sign time is bounded"                             | `take: 200` on the avg-samples query   |
| "Recent and activity see the same snapshot"            | All three findManys share one transaction |

If you remember nothing else: **the page should describe what it draws,
the service should produce that data.**

---

# Phase: Templates

We promised users could pick a template and skip straight to filling in
recipients. Until now the templates page was a hardcoded array of six
fake entries with a button that fired a toast. Now it's a real feature:
admins upload PDFs, anyone can list and "use" them, and the wizard takes
the handoff and starts at step 2 with the document already loaded.

## 48. The mental model

A template is **an envelope-shaped thing with no recipients and no
field placements**. You upload a PDF, give it a name and a category,
and it sits in the library. When someone uses it the backend hands
back the PDF (so the wizard can resume) and bumps a usage counter
(so the list can show "Last used 2 days ago" without lying).

We deliberately did **not** store field positions on the template in
this iteration. Where you put a signature box depends on who's signing
— a template that pre-decides positions for "two signers, second on
page 6" rots the moment you reuse it for one signer. Less ambition,
fewer bugs.

## 49. The Prisma model

```prisma
enum TemplateCategory { LEGAL, HR, SALES, REAL_ESTATE }

model Template {
  id           String           @id @default(cuid())
  name         String
  description  String           @default("")
  category     TemplateCategory
  iconKey      String           @default("file-signature")
  documentName String
  storagePath  String?
  byteSize     Int              @default(0)
  pageCount    Int              @default(0)
  usageCount   Int              @default(0)
  lastUsedAt   DateTime?
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt
  createdBy    User?            @relation("TemplateCreator", ...)
  createdById  String?
}
```

A few choices worth noting:

- **`iconKey` is a string, not an enum.** Lucide ships hundreds of
  icons. Promoting a subset to a Prisma enum would mean a migration
  every time we wanted a new glyph. The string is mapped to a Lucide
  component on the frontend; unknown keys fall back to a default icon
  so a typo never crashes the UI.
- **`storagePath` is nullable** for the same reason
  `EnvelopeDocument.storagePath` is: the row is created first, then the
  PDF is written to disk, then the row is updated with the path. If
  the disk write throws we delete the row and never leak a half-baked
  template.
- **`usageCount` and `lastUsedAt` live on the row.** We could compute
  them by joining envelopes-that-came-from-a-template, but that
  requires a `templateId` FK on envelopes (which we don't have yet)
  and a fan-out query on every list. Two cheap columns is the right
  trade.
- **Sorted by `lastUsedAt` then `updatedAt`.** The most-used templates
  float up automatically. We don't need a separate "favourite" flag
  for that.

## 50. Where the PDF lives

Templates reuse the envelope storage pattern: bytes live on disk at

```
backend/uploads/templates/<templateId>/document.pdf
```

`backend/src/storage/files.ts` got two helpers — `writeTemplateDocument`
and `removeTemplateFiles` — that mirror their envelope counterparts.
The DB only stores a relative path, never the bytes, so the database
stays small and a `pg_dump` does not become 200MB.

## 51. The service surface

`backend/src/services/templates.service.ts` exports five functions and
nothing else:

| Function          | Purpose                                                    |
| ----------------- | ---------------------------------------------------------- |
| `listTemplates()` | Newest-used first. Excludes `storagePath` from the result. |
| `getTemplate(id)` | Single row, same shape as the list rows.                   |
| `createTemplate(caller, input)` | Row first, then file write; rollback on failure. |
| `deleteTemplate(caller, id)`    | Only the creator or an admin may delete.        |
| `useTemplate(id)` | Returns row + `data:application/pdf;base64,…` and bumps `usageCount` + `lastUsedAt`. |

The "public select" is declared once at the top of the file as a
`const` and reused by every function. That's the contract — if a future
field is added to `Template` (say a private `internalNotes` column), it
won't leak through the API by accident because nothing references
`...` or `select: undefined`.

## 52. The routes

```
GET    /templates           list every template
GET    /templates/:id       one template
POST   /templates           create (auth)
POST   /templates/:id/use   download + bump usage
DELETE /templates/:id       creator or admin only
```

All require auth — there are no public templates. We chose `POST` for
`/use` instead of `GET` because it has a side effect (the counter
bump). React Query is happy to call `POST` from a mutation; it would
not be happy to call it from `useQuery` because the same call would
fire twice in StrictMode.

## 53. The "use template" handoff

This is the only interesting bit of frontend wiring. The card's "Use
template" button doesn't fetch anything itself — it just navigates:

```ts
router.push(`/envelopes/new?template=${template.id}`)
```

The wizard reads the param on mount, fires
`useUseTemplateMutation`, dispatches four actions in a row, and skips
to step 2:

```ts
dispatch({ type: "set-document", document: { ..., dataUrl: contentBase64 } })
dispatch({ type: "set-page-count", count: template.pageCount })
dispatch({ type: "set-subject", value: template.name })
dispatch({ type: "goto", step: 2 })
```

A `useRef` guards against StrictMode firing the effect twice — without
it the dev build would call `/use` twice and inflate `usageCount` by
two on every visit. The ref check is `templateLoadedRef.current ===
templateId`; we set it before kicking off the mutation, so the second
effect run is a no-op.

The page itself needs a `<Suspense fallback={null}>` boundary around
the wizard because `useSearchParams()` requires one — without it Next
issues a build-time warning and statically opts the route out of
prerendering.

## 54. The create dialog

`new-template-dialog.tsx` is a thin wrapper around the same PDF→base64
encoder the upload step uses. The dialog also parses the PDF locally
with `pdfjs.getDocument(...).numPages` to pre-fill the page count, so
the user never has to type it. Failures to parse aren't fatal — we
send `pageCount: 0` and the card shows "0 pages" rather than crashing.

## 55. End-to-end: a user picks a template

```
 1. User clicks "Use template" on the NDA card
 2. router.push("/envelopes/new?template=tpl_abc")
 3. /envelopes/new mounts, wizard reads ?template=tpl_abc
 4. ref guard set → useUseTemplateMutation fires POST /templates/:id/use
 5. Backend reads PDF from disk, returns { template, contentBase64 }
 6. Backend increments usageCount + updates lastUsedAt
 7. Wizard dispatches set-document / set-page-count / set-subject / goto-2
 8. UI re-renders on step 2 with the PDF preloaded
 9. User adds recipients, places fields, sends
10. Templates list invalidated → next visit shows the new lastUsedAt
```

The wizard reducer didn't need any new actions — every dispatch we
fire was already supported. Loading a template is *strictly* a
sequence of existing state changes. That's a sign the abstraction
was at the right level.

## 56. Promises updated

| Promise                                              | Where                                          |
| ---------------------------------------------------- | ---------------------------------------------- |
| "Templates are real, not hardcoded"                  | `Template` model + `useTemplatesQuery`         |
| "Uploading a PDF works"                              | `writeTemplateDocument` + create dialog        |
| "The wizard starts from the right step"              | `dispatch({ type: "goto", step: 2 })`          |
| "Using a template doesn't double-count in StrictMode" | `templateLoadedRef` guard                     |
| "Only the creator can delete"                        | `deleteTemplate` enforces; UI hides the button |
| "List stays fresh after create/delete/use"           | `invalidateQueries({ queryKey: ["templates"] })` |

If you remember nothing else: **a template is a frozen first step of
the wizard, and "use template" just dispatches the actions you would
have dispatched manually.**

