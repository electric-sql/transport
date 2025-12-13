/**
 * Tool result routes - submit tool execution results.
 */

import { Hono } from 'hono'
import type { AIDBSessionProtocol } from '../protocol'
import { toolResultRequestSchema } from '../types'

/**
 * Create tool result routes.
 */
export function createToolResultRoutes(protocol: AIDBSessionProtocol) {
  const app = new Hono()

  /**
   * POST /v1/sessions/:sessionId/tool-results
   *
   * Submit a tool execution result.
   */
  app.post('/:sessionId/tool-results', async (c) => {
    const sessionId = c.req.param('sessionId')

    try {
      const rawBody = await c.req.json()
      const body = toolResultRequestSchema.parse(rawBody)

      const actorId = c.req.header('X-Actor-Id') ?? crypto.randomUUID()
      const messageId = body.messageId ?? crypto.randomUUID()

      // Get session
      const stream = await protocol.getOrCreateSession(sessionId)

      // Write tool result
      await protocol.writeToolResult(
        stream,
        sessionId,
        messageId,
        actorId,
        body.toolCallId,
        body.output,
        body.error ?? null
      )

      return new Response(null, { status: 204 })
    } catch (error) {
      console.error('Failed to add tool result:', error)
      return c.json(
        { error: 'Failed to add tool result', details: (error as Error).message },
        500
      )
    }
  })

  return app
}
