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
   * Body: { actorId: string, deviceId: string, name?: string, defaultAgents?: AgentSpec[] }
   */
  app.post('/:sessionId/login', async (c) => {
    const sessionId = c.req.param('sessionId')

    try {
      const body = await c.req.json()
      const { actorId, deviceId, name, defaultAgents } = body as {
        actorId: string
        deviceId: string
        name?: string
        defaultAgents?: AgentSpec[]
      }

      if (!actorId || !deviceId) {
        return c.json({ error: 'actorId and deviceId are required' }, 400)
      }

      // Get or create session, registering default agents only on creation
      const stream = await protocol.getOrCreateSession(sessionId, defaultAgents)

      await protocol.writePresence(
        stream,
        sessionId,
        actorId,
        deviceId,
        'user',
        'online',
        name ?? actorId
      )

      return c.json({ success: true, actorId, deviceId, status: 'online' })
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
   *
   * Body options:
   * - { actorId: string, deviceId: string } - logout single device
   * - { actorId: string, allDevices: true } - logout all devices for this actor
   */
  app.post('/:sessionId/logout', async (c) => {
    const sessionId = c.req.param('sessionId')

    try {
      // Use text() to handle both application/json and text/plain (sendBeacon)
      const rawBody = await c.req.text()

      let body: { actorId?: string; deviceId?: string; allDevices?: boolean }
      try {
        body = JSON.parse(rawBody)
      } catch (parseError) {
        console.error('[AUTH] Failed to parse logout body:', parseError)
        return c.json({ error: 'Invalid JSON body' }, 400)
      }

      const { actorId, deviceId, allDevices } = body

      if (!actorId) {
        return c.json({ error: 'actorId is required' }, 400)
      }

      if (!deviceId && !allDevices) {
        return c.json({ error: 'deviceId or allDevices is required' }, 400)
      }

      const stream = protocol.getSession(sessionId)
      if (!stream) {
        return c.json({ error: 'Session not found' }, 404)
      }

      if (allDevices) {
        // Logout all devices for this actor by reading the raw presence collection
        const deviceIds = await protocol.getDeviceIdsForActor(sessionId, actorId)

        // Write offline for each device
        for (const devId of deviceIds) {
          await protocol.writePresence(
            stream,
            sessionId,
            actorId,
            devId,
            'user',
            'offline'
          )
        }

        return c.json({
          success: true,
          actorId,
          devicesLoggedOut: deviceIds.length,
          status: 'offline',
        })
      } else {
        // Logout single device
        await protocol.writePresence(
          stream,
          sessionId,
          actorId,
          deviceId!,
          'user',
          'offline'
        )

        return c.json({ success: true, actorId, deviceId, status: 'offline' })
      }
    } catch (error) {
      console.error('[AUTH] Failed to logout:', error)
      return c.json(
        { error: 'Failed to logout', details: (error as Error).message },
        500
      )
    }
  })

  return app
}
