/**
 * Fork routes - fork sessions at message boundaries.
 */

import { Hono } from 'hono'
import type { AIDBSessionProtocol } from '../protocol'
import { forkSessionRequestSchema, type ForkSessionResponse } from '../types'

/**
 * Create fork routes.
 */
export function createForkRoutes(protocol: AIDBSessionProtocol) {
  const app = new Hono()

  /**
   * POST /v1/sessions/:sessionId/fork
   *
   * Fork a session at a message boundary.
   */
  app.post('/:sessionId/fork', async (c) => {
    const sessionId = c.req.param('sessionId')

    try {
      const rawBody = await c.req.json()
      const body = forkSessionRequestSchema.parse(rawBody)

      const result = await protocol.forkSession(
        sessionId,
        body.atMessageId ?? null,
        body.newSessionId ?? null
      )

      const response: ForkSessionResponse = {
        sessionId: result.sessionId,
        offset: result.offset,
      }

      return c.json(response, 201)
    } catch (error) {
      console.error('Failed to fork session:', error)
      return c.json(
        { error: 'Failed to fork session', details: (error as Error).message },
        500
      )
    }
  })

  return app
}
