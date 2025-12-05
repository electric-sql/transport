/**
 * AIDBSessionProtocol - Wrapper Protocol implementation for AI DB.
 *
 * Extends the @durable-streams/wrapper-sdk to provide:
 * - Session management
 * - LLM API proxying with stream teeing
 * - Agent webhook invocation
 * - Chunk framing with sequence numbers
 */

import {
  WrapperProtocol,
  InMemoryStorage,
  type Storage,
  type Stream,
} from '@durable-streams/wrapper-sdk'
import type {
  StreamRow,
  StreamChunk,
  AgentSpec,
  SessionState,
  AIDBProtocolOptions,
  ActorType,
} from './types'

/**
 * AIDBSessionProtocol extends WrapperProtocol to provide AI chat functionality
 * on top of Durable Streams.
 *
 * @example
 * ```typescript
 * const protocol = new AIDBSessionProtocol({
 *   baseUrl: 'http://localhost:3000',
 * })
 *
 * // Create or get a session
 * const stream = await protocol.getOrCreateSession('session-123')
 *
 * // Write a user message
 * await protocol.writeUserMessage(stream, 'session-123', 'user-1', 'Hello!')
 *
 * // Invoke an agent
 * await protocol.invokeAgent(stream, 'session-123', agentSpec, messages)
 * ```
 */
export class AIDBSessionProtocol extends WrapperProtocol {
  /** Sequence counters per message for deduplication */
  private messageSeqs = new Map<string, number>()

  /** Active generation abort controllers */
  private activeAbortControllers = new Map<string, AbortController>()

  constructor(options: AIDBProtocolOptions) {
    const storage: Storage =
      options.storage === 'durable-object'
        ? // In production, use DurableObjectStorage
          // For now, default to InMemoryStorage
          new InMemoryStorage()
        : new InMemoryStorage()

    super({
      baseUrl: options.baseUrl,
      storage,
    })
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Session Management
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Create a new session stream.
   */
  async createSession(sessionId: string): Promise<Stream> {
    const stream = await this.sdk.createStream({
      url: `/v1/stream/sessions/${sessionId}`,
      contentType: 'application/json',
    })

    // Initialize session state
    await this.initializeSessionState(sessionId)

    return stream
  }

  /**
   * Get an existing session stream or create if not exists.
   */
  async getOrCreateSession(sessionId: string): Promise<Stream> {
    let stream = await this.sdk.getStream(sessionId)
    if (!stream) {
      stream = await this.createSession(sessionId)
    }
    return stream
  }

  /**
   * Initialize session state in storage.
   */
  private async initializeSessionState(sessionId: string): Promise<void> {
    const key = `sessions:${sessionId}:state`
    const existing = await this.state.get<SessionState>(key)

    if (!existing) {
      const initialState: SessionState = {
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        agents: [],
        activeGenerations: [],
      }
      await this.state.set(key, initialState)
    }
  }

  /**
   * Update session's last activity timestamp.
   */
  private async updateLastActivity(sessionId: string): Promise<void> {
    const key = `sessions:${sessionId}:state`
    const state = await this.state.get<SessionState>(key)

    if (state) {
      state.lastActivityAt = new Date().toISOString()
      await this.state.set(key, state)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Chunk Writing
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get the next sequence number for a message.
   */
  private getNextSeq(messageId: string): number {
    const current = this.messageSeqs.get(messageId) ?? -1
    const next = current + 1
    this.messageSeqs.set(messageId, next)
    return next
  }

  /**
   * Clear sequence counter for a completed message.
   */
  private clearSeq(messageId: string): void {
    this.messageSeqs.delete(messageId)
  }

  /**
   * Write a chunk to the stream.
   */
  async writeChunk(
    stream: Stream,
    sessionId: string,
    messageId: string,
    actorId: string,
    actorType: ActorType,
    chunk: StreamChunk
  ): Promise<void> {
    const row: StreamRow = {
      sessionId,
      messageId,
      actorId,
      actorType,
      chunk: JSON.stringify(chunk),
      createdAt: new Date().toISOString(),
      seq: this.getNextSeq(messageId),
    }

    await stream.append(JSON.stringify(row))
    await this.updateLastActivity(sessionId)
  }

  /**
   * Write a user message to the stream.
   */
  async writeUserMessage(
    stream: Stream,
    sessionId: string,
    messageId: string,
    actorId: string,
    content: string
  ): Promise<void> {
    // Write message-start chunk
    await this.writeChunk(stream, sessionId, messageId, actorId, 'user', {
      type: 'message-start',
      role: 'user',
    })

    // Write text-delta chunk with full content
    await this.writeChunk(stream, sessionId, messageId, actorId, 'user', {
      type: 'text-delta',
      textDelta: content,
    })

    // Write message-end chunk
    await this.writeChunk(stream, sessionId, messageId, actorId, 'user', {
      type: 'message-end',
    })

    // Clean up sequence counter
    this.clearSeq(messageId)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Agent Invocation
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Invoke an agent and stream its response to the durable stream.
   */
  async invokeAgent(
    stream: Stream,
    sessionId: string,
    agent: AgentSpec,
    messageHistory: Array<{ role: string; content: string }>
  ): Promise<void> {
    const messageId = crypto.randomUUID()
    const abortController = new AbortController()

    // Track active generation
    this.activeAbortControllers.set(messageId, abortController)
    await this.addActiveGeneration(sessionId, messageId)

    try {
      // Write message-start chunk
      await this.writeChunk(stream, sessionId, messageId, agent.id, 'agent', {
        type: 'message-start',
        role: 'assistant',
      })

      // Prepare request body
      const requestBody = {
        ...agent.bodyTemplate,
        messages: messageHistory,
        stream: true,
      }

      // Call agent endpoint
      const response = await fetch(agent.endpoint, {
        method: agent.method ?? 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...agent.headers,
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      })

      if (!response.ok) {
        throw new Error(`Agent request failed: ${response.status} ${response.statusText}`)
      }

      // Stream response chunks - tee to durable stream
      if (response.body) {
        await this.streamAgentResponse(
          stream,
          sessionId,
          messageId,
          agent.id,
          response.body,
          abortController.signal
        )
      }

      // Write message-end chunk
      await this.writeChunk(stream, sessionId, messageId, agent.id, 'agent', {
        type: 'message-end',
      })
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // Write stop chunk on abort
        await this.writeChunk(stream, sessionId, messageId, agent.id, 'agent', {
          type: 'stop',
          reason: 'aborted',
        })
      } else {
        // Write error chunk
        await this.writeChunk(stream, sessionId, messageId, agent.id, 'agent', {
          type: 'error',
          error: (error as Error).message,
        })
      }
      throw error
    } finally {
      // Clean up
      this.clearSeq(messageId)
      this.activeAbortControllers.delete(messageId)
      await this.removeActiveGeneration(sessionId, messageId)
    }
  }

  /**
   * Stream agent response, parsing SSE and writing chunks to durable stream.
   */
  private async streamAgentResponse(
    stream: Stream,
    sessionId: string,
    messageId: string,
    agentId: string,
    responseBody: ReadableStream<Uint8Array>,
    signal: AbortSignal
  ): Promise<void> {
    const reader = responseBody.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        if (signal.aborted) break

        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Parse SSE format
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith(':')) continue

          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6)
            if (data === '[DONE]') continue

            try {
              const chunk = JSON.parse(data) as StreamChunk
              await this.writeChunk(
                stream,
                sessionId,
                messageId,
                agentId,
                'agent',
                chunk
              )
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        const data = buffer.startsWith('data: ') ? buffer.slice(6) : buffer
        if (data !== '[DONE]') {
          try {
            const chunk = JSON.parse(data) as StreamChunk
            await this.writeChunk(stream, sessionId, messageId, agentId, 'agent', chunk)
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Agent Registration
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Register an agent for a session.
   */
  async registerAgent(sessionId: string, agent: AgentSpec): Promise<void> {
    const key = `sessions:${sessionId}:state`
    const state = await this.state.get<SessionState>(key)

    if (state) {
      // Remove existing agent with same ID
      state.agents = state.agents.filter((a) => a.id !== agent.id)
      // Add new agent
      state.agents.push(agent)
      await this.state.set(key, state)
    }
  }

  /**
   * Register multiple agents for a session.
   */
  async registerAgents(sessionId: string, agents: AgentSpec[]): Promise<void> {
    for (const agent of agents) {
      await this.registerAgent(sessionId, agent)
    }
  }

  /**
   * Unregister an agent from a session.
   */
  async unregisterAgent(sessionId: string, agentId: string): Promise<void> {
    const key = `sessions:${sessionId}:state`
    const state = await this.state.get<SessionState>(key)

    if (state) {
      state.agents = state.agents.filter((a) => a.id !== agentId)
      await this.state.set(key, state)
    }
  }

  /**
   * Get all registered agents for a session.
   */
  async getRegisteredAgents(sessionId: string): Promise<AgentSpec[]> {
    const key = `sessions:${sessionId}:state`
    const state = await this.state.get<SessionState>(key)
    return state?.agents ?? []
  }

  /**
   * Notify registered agents based on trigger mode.
   */
  async notifyRegisteredAgents(
    stream: Stream,
    sessionId: string,
    triggerType: 'all' | 'user-messages',
    messageHistory: Array<{ role: string; content: string }>
  ): Promise<void> {
    const agents = await this.getRegisteredAgents(sessionId)

    for (const agent of agents) {
      const shouldTrigger =
        agent.triggers === 'all' ||
        agent.triggers === triggerType ||
        (agent.triggers === undefined && triggerType === 'user-messages')

      if (shouldTrigger) {
        // Invoke agent asynchronously (don't await)
        this.invokeAgent(stream, sessionId, agent, messageHistory).catch((err) => {
          console.error(`Failed to invoke agent ${agent.id}:`, err)
        })
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Active Generation Tracking
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Add an active generation to tracking.
   */
  private async addActiveGeneration(
    sessionId: string,
    messageId: string
  ): Promise<void> {
    const key = `sessions:${sessionId}:state`
    const state = await this.state.get<SessionState>(key)

    if (state) {
      if (!state.activeGenerations.includes(messageId)) {
        state.activeGenerations.push(messageId)
        await this.state.set(key, state)
      }
    }
  }

  /**
   * Remove an active generation from tracking.
   */
  private async removeActiveGeneration(
    sessionId: string,
    messageId: string
  ): Promise<void> {
    const key = `sessions:${sessionId}:state`
    const state = await this.state.get<SessionState>(key)

    if (state) {
      state.activeGenerations = state.activeGenerations.filter(
        (id) => id !== messageId
      )
      await this.state.set(key, state)
    }
  }

  /**
   * Stop an active generation.
   */
  async stopGeneration(sessionId: string, messageId: string | null): Promise<void> {
    if (messageId) {
      // Stop specific generation
      const controller = this.activeAbortControllers.get(messageId)
      if (controller) {
        controller.abort()
      }
    } else {
      // Stop all active generations for session
      const key = `sessions:${sessionId}:state`
      const state = await this.state.get<SessionState>(key)

      if (state) {
        for (const id of state.activeGenerations) {
          const controller = this.activeAbortControllers.get(id)
          if (controller) {
            controller.abort()
          }
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Tool Results & Approvals
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Write a tool result to the stream.
   */
  async writeToolResult(
    stream: Stream,
    sessionId: string,
    actorId: string,
    toolCallId: string,
    output: unknown,
    error: string | null
  ): Promise<void> {
    const messageId = crypto.randomUUID()

    await this.writeChunk(stream, sessionId, messageId, actorId, 'user', {
      type: 'tool-result',
      toolCallId,
      output,
      error,
    })

    this.clearSeq(messageId)
  }

  /**
   * Write an approval response to the stream.
   */
  async writeApprovalResponse(
    stream: Stream,
    sessionId: string,
    actorId: string,
    approvalId: string,
    approved: boolean
  ): Promise<void> {
    const messageId = crypto.randomUUID()

    await this.writeChunk(stream, sessionId, messageId, actorId, 'user', {
      type: 'approval-response',
      approvalId,
      approved,
    })

    this.clearSeq(messageId)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Session Forking
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Fork a session at a specific message boundary.
   *
   * This creates a new session with history up to the specified message.
   */
  async forkSession(
    sessionId: string,
    atMessageId: string | null,
    newSessionId: string | null
  ): Promise<{ sessionId: string; offset: string }> {
    const targetSessionId = newSessionId ?? crypto.randomUUID()

    // Get the source stream
    const sourceStream = await this.sdk.getStream(sessionId)
    if (!sourceStream) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // Create the new session
    const targetStream = await this.createSession(targetSessionId)

    // Copy state (agents, etc.)
    const sourceStateKey = `sessions:${sessionId}:state`
    const sourceState = await this.state.get<SessionState>(sourceStateKey)

    if (sourceState) {
      const targetStateKey = `sessions:${targetSessionId}:state`
      await this.state.set(targetStateKey, {
        ...sourceState,
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        activeGenerations: [],
      })
    }

    // TODO: Copy stream data up to atMessageId
    // This requires reading from source stream and writing to target
    // For now, return the empty new session

    return {
      sessionId: targetSessionId,
      offset: '-1',
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Message History
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get message history for a session.
   *
   * This reads the stream and materializes messages.
   */
  async getMessageHistory(
    sessionId: string
  ): Promise<Array<{ role: string; content: string }>> {
    // TODO: Read from stream and materialize messages
    // For now, return empty array - client should pass history
    return []
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Lifecycle Hooks (from Wrapper SDK)
  // ═══════════════════════════════════════════════════════════════════════

  async onStreamCreated(stream: Stream, metadata: unknown): Promise<void> {
    console.log(`Session stream created: ${stream.id}`, metadata)
  }

  async onMessageAppended(stream: Stream, data: Uint8Array): Promise<void> {
    // Can be used for analytics, logging, etc.
  }
}
