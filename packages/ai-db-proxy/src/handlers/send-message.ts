/**
 * Send message handler - handles sending messages to a session.
 */

import type { Context } from 'hono'
import type { AIDBSessionProtocol } from '../protocol'
import {
  sendMessageRequestSchema,
  type SendMessageRequest,
  type SendMessageResponse,
} from '../types'

/**
 * Handle sending a message to a session.
 *
 * This handler:
 * 1. Validates the request
 * 2. Generates messageId if not provided
 * 3. Writes user message chunks to the stream
 * 4. Optionally invokes an inline agent
 * 5. Notifies registered agents
 */
export async function handleSendMessage(
  c: Context,
  protocol: AIDBSessionProtocol
): Promise<Response> {
  const sessionId = c.req.param('sessionId')

  // Parse and validate request body
  let body: SendMessageRequest
  try {
    const rawBody = await c.req.json()
    body = sendMessageRequestSchema.parse(rawBody)
  } catch (error) {
    return c.json(
      { error: 'Invalid request body', details: (error as Error).message },
      400
    )
  }

  // Get actor info from headers or body
  const actorId =
    body.actorId ??
    c.req.header('X-Actor-Id') ??
    crypto.randomUUID()
  const actorType = body.actorType ?? 'user'

  // Generate messageId if not provided
  const messageId = body.messageId ?? crypto.randomUUID()

  try {
    // Get or create the session stream
    const stream = await protocol.getOrCreateSession(sessionId)

    // Write user message (with optional txid for client sync confirmation)
    await protocol.writeUserMessage(
      stream,
      sessionId,
      messageId,
      actorId,
      body.content,
      body.txid
    )

    // Build message history for agent invocation
    // In a full implementation, we'd read from the stream
    const messageHistory = [
      {
        role: body.role ?? 'user',
        content: body.content,
      },
    ]

    // Invoke agents in the background.
    // Errors are written to the stream via writeChunk({ type: 'error', ... })
    // inside invokeAgent, so clients will see them via sync.
    if (body.agent) {
      protocol.invokeAgent(stream, sessionId, body.agent, messageHistory)
    }
    protocol.notifyRegisteredAgents(stream, sessionId, 'user-messages', messageHistory)

    const response: SendMessageResponse = { messageId }
    return c.json(response, 200)
  } catch (error) {
    console.error('Failed to send message:', error)
    return c.json(
      { error: 'Failed to send message', details: (error as Error).message },
      500
    )
  }
}
