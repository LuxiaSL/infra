/**
 * Infra Error Classes
 */

/**
 * Base error class for Infra
 */
export class InfraError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus: number = 500,
    public readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'InfraError'
  }

  /**
   * Convert to API error response format
   */
  toResponse(): { error: string; message: string; details?: Record<string, unknown> } {
    return {
      error: this.code,
      message: this.message,
      details: this.details,
    }
  }
}

/**
 * Insufficient balance error (402)
 */
export class InsufficientBalanceError extends InfraError {
  constructor(required: number, available: number) {
    super(
      'User does not have enough ichor',
      'INSUFFICIENT_BALANCE',
      402,
      { required, available }
    )
    this.name = 'InsufficientBalanceError'
  }
}

/**
 * User not found error (404)
 */
export class UserNotFoundError extends InfraError {
  constructor(userId: string) {
    super(
      `User ${userId} not found`,
      'USER_NOT_FOUND',
      404,
      { userId }
    )
    this.name = 'UserNotFoundError'
  }
}

/**
 * Server not found error (404)
 */
export class ServerNotFoundError extends InfraError {
  constructor(serverId: string) {
    super(
      `Server ${serverId} not found`,
      'SERVER_NOT_FOUND',
      404,
      { serverId }
    )
    this.name = 'ServerNotFoundError'
  }
}

/**
 * Bot not configured error (404)
 */
export class BotNotConfiguredError extends InfraError {
  constructor(botId: string, serverId?: string) {
    super(
      `Bot ${botId} has no cost configured`,
      'BOT_NOT_CONFIGURED',
      404,
      { botId, serverId }
    )
    this.name = 'BotNotConfiguredError'
  }
}

/**
 * Invalid transfer error (400)
 */
export class InvalidTransferError extends InfraError {
  constructor(reason: string) {
    super(
      `Invalid transfer: ${reason}`,
      'INVALID_TRANSFER',
      400,
      { reason }
    )
    this.name = 'InvalidTransferError'
  }
}

/**
 * Rate limited error (429)
 */
export class RateLimitedError extends InfraError {
  constructor(retryAfter?: number) {
    super(
      'Too many requests',
      'RATE_LIMITED',
      429,
      retryAfter ? { retryAfter } : undefined
    )
    this.name = 'RateLimitedError'
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends InfraError {
  constructor(message: string, field?: string) {
    super(
      message,
      'VALIDATION_ERROR',
      400,
      field ? { field } : undefined
    )
    this.name = 'ValidationError'
  }
}

/**
 * Database error (500)
 */
export class DatabaseError extends InfraError {
  constructor(message: string, cause?: Error) {
    super(
      message,
      'DATABASE_ERROR',
      500,
      cause ? { cause: cause.message } : undefined
    )
    this.name = 'DatabaseError'
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends InfraError {
  constructor(message: string, resource?: string) {
    super(
      message,
      'NOT_FOUND',
      404,
      resource ? { resource } : undefined
    )
    this.name = 'NotFoundError'
  }
}

/**
 * Conflict error (409)
 */
export class ConflictError extends InfraError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(
      message,
      'CONFLICT',
      409,
      details
    )
    this.name = 'ConflictError'
  }
}
