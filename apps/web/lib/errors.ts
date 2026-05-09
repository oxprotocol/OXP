/**
 * Domain-typed error for user-facing failures in server actions / API routes.
 *
 * Generic `throw new Error("FORBIDDEN")` strings work but lose type information
 * — every caller has to compare `error.message` to a magic string and decide
 * what HTTP status to map it to. `AppError` carries the code + status together,
 * so route handlers can `if (e instanceof AppError) return new Response(..., {status: e.status})`
 * without any string parsing.
 *
 * Codes are intentionally kept short and stable (used as JSON error bodies).
 */
export type AppErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFIRMATION_MISMATCH"
  | "CONFLICT"
  | "NOT_IMPLEMENTED"
  | "RATE_LIMITED"
  | "INTERNAL";

const DEFAULT_STATUS: Record<AppErrorCode, number> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  CONFIRMATION_MISMATCH: 400,
  CONFLICT: 409,
  NOT_IMPLEMENTED: 501,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  public readonly code: AppErrorCode;
  public readonly status: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: AppErrorCode,
    message?: string,
    opts: { status?: number; details?: Record<string, unknown> } = {},
  ) {
    super(message ?? code);
    this.name = "AppError";
    this.code = code;
    this.status = opts.status ?? DEFAULT_STATUS[code];
    this.details = opts.details;
  }
}
