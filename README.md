# Cuebites eSign — Backend

Express + Prisma + Postgres API for authentication and (later) envelope persistence.

## Quickstart

```bash
cd backend
cp .env.example .env
# Edit .env: set DATABASE_URL to your local Postgres + a long JWT_SECRET.
npm install
npm run db:generate        # generate the Prisma client
npm run db:migrate -- --name init    # create tables in your Postgres
npm run db:seed            # seeds admin@example.com / admin123 (role=ADMIN)
npm run dev                # starts on http://localhost:4000
```

The Next.js app at `..` reads `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`)
and sends `credentials: "include"` so the session cookie round-trips.

## Stack

- Node 20+
- Express 4
- Prisma 5 + Postgres
- `bcryptjs` for password hashing (12 rounds)
- `jsonwebtoken` signed sessions
- Sessions stored as **httpOnly secure cookie** (`COOKIE_NAME=cb_session`),
  `SameSite=Lax` by default — works for `localhost:3000` ↔ `localhost:4000`
  because they share the `localhost` site.

## Endpoints

| Method | Path           | Auth        | Body                                | Notes                            |
| ------ | -------------- | ----------- | ----------------------------------- | -------------------------------- |
| GET    | `/health`      | —           | —                                   | Liveness                         |
| POST   | `/auth/login`  | —           | `{ email, password }`               | Sets session cookie              |
| POST   | `/auth/logout` | —           | —                                   | Clears session cookie            |
| GET    | `/auth/me`     | session     | —                                   | Returns the current user         |
| POST   | `/auth/register` | ADMIN     | `{ email, password, name, role? }`  | Create a user (any role)         |
| GET    | `/users`       | ADMIN/MGR   | —                                   | List users                       |

## Roles

`ADMIN`, `MANAGER`, `EMPLOYEE`. New users default to `EMPLOYEE`. Only `ADMIN`
can call `POST /auth/register`. `GET /users` is open to `ADMIN` and `MANAGER`.

## Scripts

| Script                | What it does                                            |
| --------------------- | ------------------------------------------------------- |
| `npm run dev`         | Watch mode via `tsx` (no compile step needed)           |
| `npm run build`       | TypeScript build into `dist/`                           |
| `npm run start`       | Run the compiled server                                 |
| `npm run typecheck`   | `tsc --noEmit`                                          |
| `npm run db:generate` | Regenerate Prisma client after schema edits             |
| `npm run db:migrate`  | Create + apply a new migration (`-- --name <name>`)     |
| `npm run db:push`     | Apply schema to DB without creating a migration         |
| `npm run db:reset`    | Drop + recreate + re-run migrations + re-seed           |
| `npm run db:seed`     | Insert the seed admin user                              |
| `npm run db:studio`   | Prisma Studio at http://localhost:5555                  |

## Configuration

Everything is driven from `.env`. See `.env.example` for the full list. Key items:

- `DATABASE_URL` — Postgres connection string
- `JWT_SECRET` — long random secret; generate with `openssl rand -base64 48`
- `JWT_TTL` — token lifetime (e.g. `7d`)
- `CORS_ORIGIN` — Next.js dev URL (defaults to `http://localhost:3000`)
- `COOKIE_SECURE` — `true` in production behind HTTPS
- `COOKIE_SAMESITE` — `lax` for same-site dev; `none` when the API is on a
  different site (requires `COOKIE_SECURE=true`).
