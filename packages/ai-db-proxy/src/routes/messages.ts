/**
 * Message routes - send and manage messages.
 */

import { Hono } from 'hono'
import type { AIDBSessionProtocol } from '../protocol'
import { handleSendMessage } from '../handlers/send-message'
import {
  regenerateRequestSchema,
  stopGenerationRequestSchema,
} from '../types'

/**
 * Create message routes.
 */
export function createMessageRoutes(protocol: AIDBSessionProtocol) {
  const app = new Hono()

  /**
   * POST /v1/sessions/:sessionId/messages
   *
   * Send a message to a session.
   */
  app.post('/:sessionId/messages', async (c) => {
    return handleSendMessage(c, protocol)
  })

  /**
   * POST /v1/sessions/:sessionId/regenerate
   *
   * Regenerate the response from a specific message.
   */
  app.post('/:sessionId/regenerate', async (c) => {
    const sessionId = c.req.param('sessionId')

    try {
      const rawBody = await c.req.json()
      const body = regenerateRequestSchema.parse(rawBody)

      const actorId = body.actorId ?? c.req.header('X-Actor-Id') ?? crypto.randomUUID()

      // Get session
      const stream = await protocol.getOrCreateSession(sessionId)

      // Get registered agents
      const agents = await protocol.getRegisteredAgents(sessionId)

      if (agents.length === 0) {
        return c.json({ error: 'No agents registered for regeneration' }, 400)
      }

      // Build message history (simplified - in full impl, read from stream)
      const messageHistory = [
        {
          role: 'user',
          content: body.content,
        },
      ]

      // Invoke first agent for regeneration
      await protocol.invokeAgent(stream, sessionId, agents[0], messageHistory)

      return c.json({ success: true }, 200)
    } catch (error) {
      console.error('Failed to regenerate:', error)
      return c.json(
        { error: 'Failed to regenerate', details: (error as Error).message },
        500
      )
    }
  })

  /**
   * POST /v1/sessions/:sessionId/stop
   *
   * Stop active generations.
   */
  app.post('/:sessionId/stop', async (c) => {
    const sessionId = c.req.param('sessionId')

    try {
      const rawBody = await c.req.json()
      const body = stopGenerationRequestSchema.parse(rawBody)

      await protocol.stopGeneration(sessionId, body.messageId ?? null)

      return new Response(null, { status: 204 })
    } catch (error) {
      console.error('Failed to stop generation:', error)
      return c.json(
        { error: 'Failed to stop generation', details: (error as Error).message },
        500
      )
    }
  })

  return app
}
