export type ErrorCode =
  | "storage"
  | "future-version"
  | "invalid-data"
  | "conflict"
  | "partial-write"
  | "operation"

export class AppError extends Error {
  readonly code: ErrorCode
  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "AppError"
    this.code = code
  }
}

export function errorMessage(error: unknown, fallback = "操作失败，请重试") {
  return error instanceof AppError ? error.message : fallback
}
