/**
 * API Server
 * Express server setup following ChapterX patterns
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express'
import type { Server } from 'http'
import type { Database } from 'better-sqlite3'
import type { ApiConfig } from '../types/index.js'
import type { InfraEventBus } from '../types/events.js'
import { createAuthMiddleware } from './middleware/auth.js'
import { InfraError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'

// Route handlers
import { createHealthRouter } from './routes/health.js'
import { createBalanceRouter } from './routes/balance.js'
import { createCheckRouter } from './routes/check.js'
import { createTransferRouter } from './routes/transfer.js'
import { createCostsRouter } from './routes/costs.js'
import { createRewardRouter } from './routes/reward.js'
import { createHistoryRouter } from './routes/history.js'
import { createAdminRouter } from './routes/admin.js'
import { createRefundRouter } from './routes/refund.js'
import { createTrackingRouter } from './routes/tracking.js'
import { createLeaderboardRoutes } from './routes/leaderboard.js'

export class ApiServer {
  private app: Express
  private server: Server | null = null
  private startTime: Date

  constructor(
    private config: ApiConfig,
    private db: Database,
    eventBus?: InfraEventBus
  ) {
    this.app = express()
    this.startTime = new Date()

    // Make eventBus available to routes via app.get('eventBus')
    if (eventBus) {
      this.app.set('eventBus', eventBus)
    }

    this.setupMiddleware()
    this.setupRoutes()
    this.setupErrorHandler()
  }

  private setupMiddleware(): void {
    // Parse JSON bodies
    this.app.use(express.json())

    // CORS headers
    this.app.use((req: Request, res: Response, next: NextFunction): void => {
      res.header('Access-Control-Allow-Origin', '*')
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

      if (req.method === 'OPTIONS') {
        res.sendStatus(200)
        return
      }
      next()
    })

    // Request logging
    this.app.use((req: Request, res: Response, next: NextFunction): void => {
      const start = Date.now()
      res.on('finish', () => {
        const duration = Date.now() - start
        logger.debug({
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration,
        }, 'Request handled')
      })
      next()
    })

    // Auth middleware
    this.app.use(createAuthMiddleware(this.config.serviceTokens))
  }

  private setupRoutes(): void {
    // Health check (no auth)
    this.app.use(createHealthRouter(() => this.getUptime()))

    // API v1 routes
    const v1 = '/api/v1'
    this.app.use(v1, createBalanceRouter(this.db))
    this.app.use(v1, createCheckRouter(this.db))
    this.app.use(v1, createTransferRouter(this.db))
    this.app.use(v1, createCostsRouter(this.db))
    this.app.use(v1, createRewardRouter(this.db))
    this.app.use(v1, createHistoryRouter(this.db))
    this.app.use(v1, createRefundRouter(this.db))
    this.app.use(v1, createTrackingRouter(this.db))
    this.app.use(v1, createAdminRouter(this.db))
    this.app.use(`${v1}/leaderboard`, createLeaderboardRoutes(this.db))

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: `Endpoint ${req.method} ${req.path} not found`,
      })
    })
  }

  private setupErrorHandler(): void {
    // Global error handler
    this.app.use((err: Error, req: Request, res: Response, _next: NextFunction): void => {
      logger.error({ error: err, path: req.path, method: req.method }, 'Unhandled error')

      if (err instanceof InfraError) {
        res.status(err.httpStatus).json(err.toResponse())
        return
      }

      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      })
    })
  }

  private getUptime(): number {
    return Math.floor((Date.now() - this.startTime.getTime()) / 1000)
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.port, () => {
        logger.info({ port: this.config.port }, 'API server started')
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          logger.info('API server stopped')
          resolve()
        })
      })
    }
  }
}
