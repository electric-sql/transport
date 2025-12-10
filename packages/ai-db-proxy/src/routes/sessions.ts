/**
 * Session routes - create, get, and manage sessions.
 */

import { Hono } from 'hono'
import type { AIDBSessionProtocol } from '../protocol'

/**
 * Create session routes.
 */
export function createSessionRoutes(protocol: AIDBSessionProtocol) {
  const app = new Hono()

  /**
   * PUT /v1/sessions/:sessionId
   *
   * Create or get a session.
   */
  app.put('/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId')

    try {
      const stream = await protocol.getOrCreateSession(sessionId)

      // Return 201 if new, 200 if existing
      // For simplicity, always return 200 with stream info
      return c.json(
        {
          sessionId,
          streamUrl: `/v1/stream/sessions/${sessionId}`,
        },
        200
      )
    } catch (error) {
      console.error('Failed to create session:', error)
      return c.json(
        { error: 'Failed to create session', details: (error as Error).message },
        500
      )
    }
  })

  /**
   * GET /v1/sessions/:sessionId
   *
   * Get session info.
   */
  app.get('/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId')

    try {
      const stream = await protocol.getSession(sessionId)

      if (!stream) {
        return c.json({ error: 'Session not found' }, 404)
      }

      return c.json({
        sessionId,
        streamUrl: `/v1/stream/sessions/${sessionId}`,
      })
    } catch (error) {
      console.error('Failed to get session:', error)
      return c.json(
        { error: 'Failed to get session', details: (error as Error).message },
        500
      )
    }
  })

  /**
   * DELETE /v1/sessions/:sessionId
   *
   * Delete a session.
   */
  app.delete('/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId')

    try {
      await protocol.deleteSession(sessionId)
      return new Response(null, { status: 204 })
    } catch (error) {
      console.error('Failed to delete session:', error)
      return c.json(
        { error: 'Failed to delete session', details: (error as Error).message },
        500
      )
    }
  })

  return app
}
