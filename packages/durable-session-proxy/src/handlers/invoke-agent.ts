/**
 * Invoke agent handler - handles agent webhook invocation.
 */

import type { Context } from 'hono'
import type { AIDBSessionProtocol } from '../protocol'
import { agentSpecSchema, type AgentSpec } from '../types'
import { z } from 'zod'

/**
 * Request body for invoking an agent.
 */
const invokeAgentRequestSchema = z.object({
  agent: agentSpecSchema,
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.string(),
    })
  ),
})

type InvokeAgentRequest = z.infer<typeof invokeAgentRequestSchema>

/**
 * Handle invoking an agent for a session.
 *
 * This handler:
 * 1. Validates the request
 * 2. Invokes the agent endpoint
 * 3. Streams the response to the durable stream
 */
export async function handleInvokeAgent(
  c: Context,
  protocol: AIDBSessionProtocol
): Promise<Response> {
  const sessionId = c.req.param('sessionId')

  // Parse and validate request body
  let body: InvokeAgentRequest
  try {
    const rawBody = await c.req.json()
    body = invokeAgentRequestSchema.parse(rawBody)
  } catch (error) {
    return c.json(
      { error: 'Invalid request body', details: (error as Error).message },
      400
    )
  }

  try {
    // Get or create the session stream
    const stream = await protocol.getOrCreateSession(sessionId)

    // Invoke the agent
    await protocol.invokeAgent(stream, sessionId, body.agent, body.messages)

    return c.json({ success: true }, 200)
  } catch (error) {
    console.error('Failed to invoke agent:', error)
    return c.json(
      { error: 'Failed to invoke agent', details: (error as Error).message },
      500
    )
  }
}

/**
 * Handle registering agents for a session.
 */
export async function handleRegisterAgents(
  c: Context,
  protocol: AIDBSessionProtocol
): Promise<Response> {
  const sessionId = c.req.param('sessionId')

  // Parse and validate request body
  let agents: AgentSpec[]
  try {
    const rawBody = await c.req.json()
    const parsed = z.object({ agents: z.array(agentSpecSchema) }).parse(rawBody)
    agents = parsed.agents
  } catch (error) {
    return c.json(
      { error: 'Invalid request body', details: (error as Error).message },
      400
    )
  }

  try {
    // Ensure session exists
    await protocol.getOrCreateSession(sessionId)

    // Register agents
    await protocol.registerAgents(sessionId, agents)

    return c.json({ success: true }, 200)
  } catch (error) {
    console.error('Failed to register agents:', error)
    return c.json(
      { error: 'Failed to register agents', details: (error as Error).message },
      500
    )
  }
}

/**
 * Handle unregistering an agent from a session.
 */
export async function handleUnregisterAgent(
  c: Context,
  protocol: AIDBSessionProtocol
): Promise<Response> {
  const sessionId = c.req.param('sessionId')
  const agentId = c.req.param('agentId')

  try {
    await protocol.unregisterAgent(sessionId, agentId)
    return new Response(null, { status: 204 })
  } catch (error) {
    console.error('Failed to unregister agent:', error)
    return c.json(
      { error: 'Failed to unregister agent', details: (error as Error).message },
      500
    )
  }
}
