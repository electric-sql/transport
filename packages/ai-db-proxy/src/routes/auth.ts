/**
 * Auth routes - login/logout for presence management.
 */

import { Hono } from 'hono'
import type { AIDBSessionProtocol } from '../protocol'
import type { AgentSpec } from '../types'

/**
 * Create auth routes for login/logout.
 */
export function createAuthRoutes(protocol: AIDBSessionProtocol) {
  const app = new Hono()

  /**
   * POST /v1/sessions/:sessionId/login
   *
   * Login a user to a session (writes presence with status: 'online').
   * Optionally registers default agents if provided.
   * Body: { actorId: string, name?: string, defaultAgents?: AgentSpec[] }
   */
  app.post('/:sessionId/login', async (c) => {
    const sessionId = c.req.param('sessionId')

    try {
      const body = await c.req.json()
      const { actorId, name, defaultAgents } = body as {
        actorId: string
        name?: string
        defaultAgents?: AgentSpec[]
      }

      if (!actorId) {
        return c.json({ error: 'actorId is required' }, 400)
      }

      // Get or create session, registering default agents only on creation
      const stream = await protocol.getOrCreateSession(sessionId, defaultAgents)

      await protocol.writePresence(
        stream,
        sessionId,
        actorId,
        'user',
        'online',
        name ?? actorId
      )

      return c.json({ success: true, actorId, status: 'online' })
    } catch (error) {
      console.error('Failed to login:', error)
      return c.json(
        { error: 'Failed to login', details: (error as Error).message },
        500
      )
    }
  })

  /**
   * POST /v1/sessions/:sessionId/logout
   *
   * Logout a user from a session (writes presence with status: 'offline').
   * Body: { actorId: string }
   */
  app.post('/:sessionId/logout', async (c) => {
    const sessionId = c.req.param('sessionId')

    try {
      const body = await c.req.json()
      const { actorId } = body as { actorId: string }

      if (!actorId) {
        return c.json({ error: 'actorId is required' }, 400)
      }

      const stream = await protocol.getSession(sessionId)
      if (!stream) {
        return c.json({ error: 'Session not found' }, 404)
      }

      await protocol.writePresence(
        stream,
        sessionId,
        actorId,
        'user',
        'offline'
      )

      return c.json({ success: true, actorId, status: 'offline' })
    } catch (error) {
      console.error('Failed to logout:', error)
      return c.json(
        { error: 'Failed to logout', details: (error as Error).message },
        500
      )
    }
  })

  return app
}
