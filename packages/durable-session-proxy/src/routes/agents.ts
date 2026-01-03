/**
 * Agent routes - register and manage agents.
 */

import { Hono } from 'hono'
import type { AIDBSessionProtocol } from '../protocol'
import {
  handleRegisterAgents,
  handleUnregisterAgent,
} from '../handlers/invoke-agent'

/**
 * Create agent routes.
 */
export function createAgentRoutes(protocol: AIDBSessionProtocol) {
  const app = new Hono()

  /**
   * POST /v1/sessions/:sessionId/agents
   *
   * Register agents for a session.
   */
  app.post('/:sessionId/agents', async (c) => {
    return handleRegisterAgents(c, protocol)
  })

  /**
   * GET /v1/sessions/:sessionId/agents
   *
   * Get all registered agents for a session.
   */
  app.get('/:sessionId/agents', async (c) => {
    const sessionId = c.req.param('sessionId')

    try {
      const agents = await protocol.getRegisteredAgents(sessionId)
      return c.json({ agents })
    } catch (error) {
      console.error('Failed to get agents:', error)
      return c.json(
        { error: 'Failed to get agents', details: (error as Error).message },
        500
      )
    }
  })

  /**
   * DELETE /v1/sessions/:sessionId/agents/:agentId
   *
   * Unregister an agent from a session.
   */
  app.delete('/:sessionId/agents/:agentId', async (c) => {
    return handleUnregisterAgent(c, protocol)
  })

  return app
}
