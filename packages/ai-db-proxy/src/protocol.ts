/**
 * AIDBSessionProtocol - STATE-PROTOCOL implementation for AI DB.
 *
 * Uses @durable-streams/client to write STATE-PROTOCOL events to Durable Streams.
 * Provides:
 * - Session management
 * - LLM API proxying with stream teeing
 * - Agent webhook invocation
 * - Chunk framing with sequence numbers
 */

import { DurableStream } from '@durable-streams/client'
import {
  sessionStateSchema,
  createSessionDB,
  createMessagesPipeline,
  createModelMessagesCollection,
} from '@electric-sql/durable-session'
import type { StreamChunk, AgentSpec, ProxySessionState, AIDBProtocolOptions } from './types'

// Map role to the role type expected by the schema
type MessageRole = 'user' | 'assistant' | 'system'

/**
 * AIDBSessionProtocol writes STATE-PROTOCOL events to Durable Streams
 * to provide AI chat functionality.
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
export class AIDBSessionProtocol {
  private readonly baseUrl: string

  /** Active streams by sessionId */
  private streams = new Map<string, DurableStream>()

  /** Sequence counters per message for deduplication */
  private messageSeqs = new Map<string, number>()

  /** Active generation abort controllers */
  private activeAbortControllers = new Map<string, AbortController>()

  /** Session state with SessionDB and collections for message materialization */
  private sessionStates = new Map<string, ProxySessionState>()

  constructor(options: AIDBProtocolOptions) {
    this.baseUrl = options.baseUrl
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Session Management
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Create a new session stream.
   *
   * Calls PUT on the Durable Streams server to create the stream before
   * returning the handle. This ensures clients can read from the stream
   * immediately (empty streams return 200 with no data, not 404).
   *
   * @param sessionId - The session ID
   * @param defaultAgents - Optional agents to register when creating the session
   */
  async createSession(
    sessionId: string,
    defaultAgents?: AgentSpec[]
  ): Promise<DurableStream> {
    const stream = new DurableStream({
      url: `${this.baseUrl}/v1/stream/sessions/${sessionId}`,
    })

    // Create the stream on the Durable Streams server
    await stream.create({ contentType: 'application/json' })

    this.streams.set(sessionId, stream)

    // Initialize session state with SessionDB and collections
    await this.initializeSessionState(sessionId)

    // Register default agents if provided
    if (defaultAgents && defaultAgents.length > 0) {
      for (const agent of defaultAgents) {
        await this.writeAgentRegistration(stream, sessionId, agent)
        const state = this.sessionStates.get(sessionId)
        if (state) {
          state.agents.push(agent)
        }
      }
    }

    return stream
  }

  /**
   * Get an existing session stream or create if not exists.
   *
   * @param sessionId - The session ID
   * @param defaultAgents - Optional agents to register when creating a new session
   */
  async getOrCreateSession(
    sessionId: string,
    defaultAgents?: AgentSpec[]
  ): Promise<DurableStream> {
    let stream = this.streams.get(sessionId)
    if (!stream) {
      stream = await this.createSession(sessionId, defaultAgents)
    }
    return stream
  }

  /**
   * Get an existing session stream.
   */
  getSession(sessionId: string): DurableStream | undefined {
    return this.streams.get(sessionId)
  }

  /**
   * Delete a session stream.
   *
   * Cleans up the DurableStream handle, SessionDB, and subscriptions.
   */
  deleteSession(sessionId: string): void {
    const state = this.sessionStates.get(sessionId)
    if (state) {
      // Unsubscribe from changes
      state.changeSubscription?.unsubscribe()
      // Close SessionDB to cleanup stream subscription
      state.sessionDB.close()
    }

    this.streams.delete(sessionId)
    this.sessionStates.delete(sessionId)
  }

  /**
   * Reset a session by writing a control reset event.
   *
   * This triggers all connected clients to truncate their local collections
   * and start fresh. Users remain connected but see an empty session.
   *
   * @param sessionId - The session ID to reset
   * @param clearPresence - If true, also clears presence (users will appear offline)
   */
  async resetSession(sessionId: string, clearPresence = false): Promise<void> {
    const stream = this.streams.get(sessionId)
    if (!stream) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // Write control reset event to the stream
    // This is handled by @durable-streams/state which truncates all collections
    const resetEvent = {
      headers: {
        control: 'reset' as const,
      },
    }

    await stream.append(resetEvent)

    // Clear in-memory state
    this.messageSeqs.clear()
    const state = this.sessionStates.get(sessionId)
    if (state) {
      state.activeGenerations = []
      if (clearPresence) {
        // Note: presence is stored in the stream, so clearing here just
        // affects the in-memory view. The reset event clears client-side.
      }
    }

    this.updateLastActivity(sessionId)
  }

  /**
   * Update session's last activity timestamp.
   */
  private updateLastActivity(sessionId: string): void {
    const state = this.sessionStates.get(sessionId)
    if (state) {
      state.lastActivityAt = new Date().toISOString()
    }
  }

  /**
   * Initialize session state with SessionDB and message collections.
   *
   * Creates a SessionDB that syncs from the session's stream and sets up
   * the message materialization pipeline.
   */
  private async initializeSessionState(sessionId: string): Promise<void> {
    // Create SessionDB (same as client does)
    const sessionDB = createSessionDB({
      sessionId,
      baseUrl: this.baseUrl,
    })

    // Preload to sync initial data from stream
    // After this, all historical messages are in the collections
    await sessionDB.preload()

    // Create the messages pipeline
    const { messages } = createMessagesPipeline({
      sessionId,
      chunksCollection: sessionDB.collections.chunks,
    })

    // Create the model messages collection (LLM-ready)
    const modelMessages = createModelMessagesCollection({
      messagesCollection: messages,
    })

    // Store in session state (subscription added in setupReactiveAgentTrigger)
    const state: ProxySessionState = {
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      agents: [],
      activeGenerations: [],
      sessionDB,
      messages,
      modelMessages,
      changeSubscription: null,
      isReady: true,
    }

    this.sessionStates.set(sessionId, state)

    // Set up reactive agent triggering
    // IMPORTANT: This must happen AFTER preload completes.
    // subscribeChanges() only fires for changes AFTER subscription,
    // so historical messages won't trigger agents.
    this.setupReactiveAgentTrigger(sessionId)
  }

  /**
   * Set up reactive agent triggering for a session.
   *
   * Subscribes to the modelMessages collection and triggers registered agents
   * when new complete user messages appear.
   *
   * KEY INSIGHT: TanStack DB's subscribeChanges() by default only fires for
   * changes that occur AFTER subscription (not existing data). Since we call
   * this AFTER preload completes, historical messages won't trigger agents.
   * No manual tracking of "preloaded message IDs" is needed.
   */
  private setupReactiveAgentTrigger(sessionId: string): void {
    const state = this.sessionStates.get(sessionId)
    if (!state) return

    const stream = this.streams.get(sessionId)
    if (!stream) return

    // Subscribe to changes in the modelMessages collection
    // By default, subscribeChanges() only fires for NEW changes (after subscription)
    // Historical messages that were loaded during preload() won't trigger this
    const subscription = state.modelMessages.subscribeChanges((changes) => {
      for (const change of changes) {
        // Only trigger for inserts (new messages)
        if (change.type !== 'insert') continue

        const message = change.value
        if (!message) continue

        // Only trigger for user messages (not assistant responses)
        if (message.role !== 'user') continue

        // Get message history and notify registered agents
        this.getMessageHistory(sessionId)
          .then((history) => {
            this.notifyRegisteredAgents(stream, sessionId, 'user-messages', history)
          })
          .catch((err) => {
            console.error(
              `[Protocol] Failed to get message history for agent trigger:`,
              err
            )
          })
      }
    })

    // Store subscription handle for cleanup
    state.changeSubscription = subscription
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Chunk Writing (STATE-PROTOCOL)
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
   * Write a chunk to the stream using STATE-PROTOCOL format.
   *
   * Creates a change event with:
   * - type: 'chunk'
   * - key: `${messageId}:${seq}`
   * - value: ChunkValue (without sessionId)
   * - headers: { operation: 'insert', txid? }
   *
   * @param txid - Optional transaction ID for client sync confirmation
   */
  async writeChunk(
    stream: DurableStream,
    sessionId: string,
    messageId: string,
    actorId: string,
    role: MessageRole,
    chunk: StreamChunk,
    txid?: string
  ): Promise<void> {
    const seq = this.getNextSeq(messageId)

    // Create STATE-PROTOCOL change event using the schema helper
    const event = sessionStateSchema.chunks.insert({
      key: `${messageId}:${seq}`,
      value: {
        messageId,
        actorId,
        role,
        chunk: JSON.stringify(chunk),
        seq,
        createdAt: new Date().toISOString(),
      },
      // Include txid in headers for client sync confirmation
      ...(txid && { headers: { txid } }),
    })

    const result = await stream.append(event)
    this.updateLastActivity(sessionId)

    return result
  }

  /**
   * Write a user message to the stream as a complete UIMessage.
   *
   * User messages are stored as complete objects in a single chunk
   * because they are complete when sent (unlike assistant messages which stream).
   *
   * @param txid - Optional transaction ID for client sync confirmation
   */
  async writeUserMessage(
    stream: DurableStream,
    sessionId: string,
    messageId: string,
    actorId: string,
    content: string,
    txid?: string
  ): Promise<void> {
    // Create complete UIMessage
    const message = {
      id: messageId,
      role: 'user' as const,
      parts: [{ type: 'text' as const, content }],
      createdAt: new Date().toISOString(),
    }

    // Create STATE-PROTOCOL change event for user message
    const event = sessionStateSchema.chunks.insert({
      key: `${messageId}:0`, // Single chunk, so seq is always 0
      value: {
        messageId,
        actorId,
        role: 'user' as const,
        chunk: JSON.stringify({
          type: 'user-message',
          message,
        }),
        seq: 0,
        createdAt: new Date().toISOString(),
      },
      // Include txid in headers for client sync confirmation
      ...(txid && { headers: { txid } }),
    })

    const result = await stream.append(event)
    this.updateLastActivity(sessionId)

    return result
  }

  /**
   * Write a presence update to the stream.
   */
  async writePresence(
    stream: DurableStream,
    sessionId: string,
    actorId: string,
    actorType: 'user' | 'agent',
    status: 'online' | 'offline' | 'away',
    name?: string
  ): Promise<void> {
    const event = sessionStateSchema.presence.upsert({
      key: actorId,
      value: {
        actorId,
        actorType,
        name,
        status,
        lastSeenAt: new Date().toISOString(),
      },
    })

    const result = await stream.append(event)
    this.updateLastActivity(sessionId)

    return result
  }

  /**
   * Write an agent registration to the stream.
   */
  async writeAgentRegistration(
    stream: DurableStream,
    sessionId: string,
    agent: AgentSpec
  ): Promise<void> {
    const event = sessionStateSchema.agents.upsert({
      key: agent.id,
      value: {
        agentId: agent.id,
        name: agent.name,
        endpoint: agent.endpoint,
        triggers: agent.triggers,
      },
    })

    const result = await stream.append(event)
    this.updateLastActivity(sessionId)

    return result
  }

  /**
   * Remove an agent registration from the stream.
   */
  async removeAgentRegistration(
    stream: DurableStream,
    sessionId: string,
    agentId: string
  ): Promise<void> {
    const event = sessionStateSchema.agents.delete({
      key: agentId,
    })

    const result = await stream.append(event)
    this.updateLastActivity(sessionId)

    return result
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Agent Invocation
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Invoke an agent and stream its response to the durable stream.
   */
  async invokeAgent(
    stream: DurableStream,
    sessionId: string,
    agent: AgentSpec,
    messageHistory: Array<{ role: string; content: string }>
  ): Promise<void> {
    const messageId = crypto.randomUUID()
    const abortController = new AbortController()

    // Track active generation
    this.activeAbortControllers.set(messageId, abortController)
    this.addActiveGeneration(sessionId, messageId)

    try {
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
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // Write stop chunk on abort
        await this.writeChunk(stream, sessionId, messageId, agent.id, 'assistant', {
          type: 'stop',
          reason: 'aborted',
        } as StreamChunk)
      } else {
        // Write error chunk
        await this.writeChunk(stream, sessionId, messageId, agent.id, 'assistant', {
          type: 'error',
          error: (error as Error).message,
        } as StreamChunk)
      }
      throw error
    } finally {
      // Clean up
      this.clearSeq(messageId)
      this.activeAbortControllers.delete(messageId)
      this.removeActiveGeneration(sessionId, messageId)
    }
  }

  /**
   * Stream agent response, parsing SSE and writing chunks to durable stream.
   */
  private async streamAgentResponse(
    stream: DurableStream,
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
                'assistant',
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
            await this.writeChunk(stream, sessionId, messageId, agentId, 'assistant', chunk)
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
    const state = this.sessionStates.get(sessionId)
    if (state) {
      // Remove existing agent with same ID
      state.agents = state.agents.filter((a) => a.id !== agent.id)
      // Add new agent
      state.agents.push(agent)

      // Also write to stream so clients can see registered agents
      const stream = this.streams.get(sessionId)
      if (stream) {
        await this.writeAgentRegistration(stream, sessionId, agent)
      }
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
    const state = this.sessionStates.get(sessionId)
    if (state) {
      state.agents = state.agents.filter((a) => a.id !== agentId)

      // Also remove from stream
      const stream = this.streams.get(sessionId)
      if (stream) {
        await this.removeAgentRegistration(stream, sessionId, agentId)
      }
    }
  }

  /**
   * Get all registered agents for a session.
   */
  getRegisteredAgents(sessionId: string): AgentSpec[] {
    const state = this.sessionStates.get(sessionId)
    return state?.agents ?? []
  }

  /**
   * Notify registered agents based on trigger mode.
   */
  async notifyRegisteredAgents(
    stream: DurableStream,
    sessionId: string,
    triggerType: 'all' | 'user-messages',
    messageHistory: Array<{ role: string; content: string }>
  ): Promise<void> {
    const agents = this.getRegisteredAgents(sessionId)

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
  private addActiveGeneration(sessionId: string, messageId: string): void {
    const state = this.sessionStates.get(sessionId)
    if (state && !state.activeGenerations.includes(messageId)) {
      state.activeGenerations.push(messageId)
    }
  }

  /**
   * Remove an active generation from tracking.
   */
  private removeActiveGeneration(sessionId: string, messageId: string): void {
    const state = this.sessionStates.get(sessionId)
    if (state) {
      state.activeGenerations = state.activeGenerations.filter((id) => id !== messageId)
    }
  }

  /**
   * Stop an active generation.
   */
  stopGeneration(sessionId: string, messageId: string | null): void {
    if (messageId) {
      // Stop specific generation
      const controller = this.activeAbortControllers.get(messageId)
      if (controller) {
        controller.abort()
      }
    } else {
      // Stop all active generations for session
      const state = this.sessionStates.get(sessionId)
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
   *
   * @param messageId - Client-generated message ID for optimistic updates.
   * @param txid - Optional transaction ID for client sync confirmation
   */
  async writeToolResult(
    stream: DurableStream,
    sessionId: string,
    messageId: string,
    actorId: string,
    toolCallId: string,
    output: unknown,
    error: string | null,
    txid?: string
  ): Promise<void> {
    const result = await this.writeChunk(stream, sessionId, messageId, actorId, 'user', {
      type: 'tool-result',
      toolCallId,
      output,
      error,
    } as StreamChunk, txid)

    this.clearSeq(messageId)
    return result
  }

  /**
   * Write an approval response to the stream.
   *
   * @param txid - Optional transaction ID for client sync confirmation
   */
  async writeApprovalResponse(
    stream: DurableStream,
    sessionId: string,
    actorId: string,
    approvalId: string,
    approved: boolean,
    txid?: string
  ): Promise<void> {
    const messageId = crypto.randomUUID()

    const result = await this.writeChunk(stream, sessionId, messageId, actorId, 'user', {
      type: 'approval-response',
      approvalId,
      approved,
    } as StreamChunk, txid)

    this.clearSeq(messageId)
    return result
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
    const sourceStream = this.streams.get(sessionId)
    if (!sourceStream) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // Create the new session
    await this.createSession(targetSessionId)

    // Copy state (agents, etc.)
    const sourceState = this.sessionStates.get(sessionId)
    if (sourceState) {
      this.sessionStates.set(targetSessionId, {
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
   * Reads from the materialized modelMessages collection which contains
   * all complete messages formatted for LLM consumption.
   *
   * @param sessionId - The session ID
   * @returns Array of messages in { role, content } format
   */
  async getMessageHistory(
    sessionId: string
  ): Promise<Array<{ role: string; content: string }>> {
    const state = this.sessionStates.get(sessionId)

    if (!state || !state.isReady) {
      console.warn(`[Protocol] Session ${sessionId} not ready for message history`)
      return []
    }

    // Read from the modelMessages collection
    // Note: toArray is a getter (property), not a method
    return state.modelMessages.toArray.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }))
  }
}
