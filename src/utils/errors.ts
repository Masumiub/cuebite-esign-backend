/**
 * Custom HTTP errors that controllers can throw from anywhere in the call
 * stack. The error middleware translates them into JSON responses with the
 * matching status code.
 *
 * Use these in service code: services have no `res` object, so the only way
 * to surface a 403 from deep inside a Prisma query helper is `throw new
 * ForbiddenError(...)`. Controllers don't need try/catch around them —
 * Express forwards thrown errors to the next error middleware.
 */
export class HttpError extends Error {
  status: number
  details?: unknown
  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = this.constructor.name
    this.status = status
    if (details !== undefined) this.details = details
  }
}

export class BadRequestError extends HttpError {
  constructor(message = "Bad request", details?: unknown) {
    super(message, 400, details)
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "Unauthorized") {
    super(message, 401)
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "Forbidden") {
    super(message, 403)
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Not found") {
    super(message, 404)
  }
}

export class ConflictError extends HttpError {
  constructor(message: string) {
    super(message, 409)
  }
}
