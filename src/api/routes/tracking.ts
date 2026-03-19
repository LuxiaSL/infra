/**
 * Message Tracking Routes
 * Endpoints for tracking bot response messages
 */

import { Router } from 'express'
import type { Database } from 'better-sqlite3'
import { z } from 'zod'
import { trackMessage, getTrackedMessage } from '../../services/tracking.js'
import { InfraError } from '../../utils/errors.js'
import type { TrackMessageRequest, TrackMessageResponse, GetTrackedMessageResponse } from '../../types/index.js'

const TrackMessageSchema = z.object({
  messageId: z.string().min(1),
  channelId: z.string().min(1),
  serverId: z.string().min(1),
  botId: z.string().min(1),
  triggerUserId: z.string().min(1),
  triggerMessageId: z.string().min(1).optional(),
})

export function createTrackingRouter(db: Database): Router {
  const router = Router()

  /**
   * POST /track-message
   * Track a bot response message for reaction rewards/tips
   */
  router.post('/track-message', async (req, res, next) => {
    try {
      const validation = TrackMessageSchema.safeParse(req.body)
      if (!validation.success) {
        throw new InfraError(
          'VALIDATION_ERROR',
          'Invalid request body',
          400,
          { errors: validation.error.flatten().fieldErrors }
        )
      }

      const body = validation.data as TrackMessageRequest

      const tracked = trackMessage(
        db,
        body.messageId,
        body.channelId,
        body.serverId,
        body.botId,
        body.triggerUserId,
        body.triggerMessageId
      )

      const response: TrackMessageResponse = {
        success: true,
        expiresAt: tracked.expiresAt.toISOString(),
      }

      res.json(response)
    } catch (error) {
      next(error)
    }
  })

  /**
   * GET /tracked-message/:messageId
   * Get a tracked message by ID (for reaction processing)
   */
  router.get('/tracked-message/:messageId', async (req, res, next) => {
    try {
      const { messageId } = req.params

      const tracked = getTrackedMessage(db, messageId)

      if (!tracked) {
        throw new InfraError(
          'NOT_FOUND',
          'Message not found or expired',
          404
        )
      }

      const response: GetTrackedMessageResponse = {
        messageId: tracked.messageId,
        channelId: tracked.channelId,
        serverId: tracked.serverId,
        botDiscordId: tracked.botDiscordId,
        triggerUserId: tracked.triggerUserId,
        triggerUserDiscordId: tracked.triggerUserDiscordId,
        triggerMessageId: tracked.triggerMessageId,
        createdAt: tracked.createdAt.toISOString(),
        expiresAt: tracked.expiresAt.toISOString(),
      }

      res.json(response)
    } catch (error) {
      next(error)
    }
  })

  return router
}


