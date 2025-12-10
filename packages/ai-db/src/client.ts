/**
 * DurableChatClient - Framework-agnostic durable chat client.
 *
 * Provides TanStack AI-compatible API backed by Durable Streams
 * with real-time sync and multi-agent support.
 *
 * All derived collections contain fully materialized objects.
 * No helper functions needed to access data.
 */

import { createCollection } from '@tanstack/db'
import type { UIMessage, AnyClientTool } from '@tanstack/ai'
import type {
  DurableChatClientOptions,
  StreamRowWithOffset,
  MessageRow,
  SessionMetaRow,
  AgentSpec,
  ConnectionStatus,
  ForkOptions,
  ForkResult,
  ToolResultInput,
  ApprovalResponseInput,
  ActorType,
} from './types'
import {
  createStreamCollectionOptions,
  createCollectedMessagesCollection,
  createMessagesCollection,
  createToolCallsCollection,
  createToolResultsCollection,
  createApprovalsCollection,
  createActiveGenerationsCollection,
  createSessionMetaCollectionOptions,
  createSessionParticipantsCollection,
  createSessionStatsCollection,
  createInitialSessionMeta,
  updateConnectionStatus,
  updateSyncProgress,
  waitForKey,
} from './collections'
import { extractTextContent } from './materialize'

/**
 * DurableChatClient provides a TanStack AI-compatible chat interface
 * backed by Durable Streams for persistence and real-time sync.
 *
 * All derived collections contain fully materialized objects.
 * Access data directly from collections - no helper functions needed.
 *
 * @example
 * ```typescript
 * import { DurableChatClient } from '@electric-sql/ai-db'
 *
 * const client = new DurableChatClient({
 *   sessionId: 'my-session',
 *   proxyUrl: 'http://localhost:4000',
 * })
 *
 * await client.connect()
 *
 * // Use TanStack AI-compatible API
 * await client.sendMessage('Hello!')
 * console.log(client.messages)
 *
 * // Or use collections directly
 * for (const message of client.collections.messages.values()) {
 *   console.log(message.id, message.role, message.parts)
 * }
 *
 * // Filter tool calls
 * const pending = [...client.collections.toolCalls.values()]
 *   .filter(tc => tc.state === 'pending')
 * ```
 */
export class DurableChatClient<
  TTools extends ReadonlyArray<AnyClientTool> = AnyClientTool[],
> {
  readonly sessionId: string
  readonly actorId: string
  readonly actorType: ActorType

  private readonly options: DurableChatClientOptions<TTools>
  // Collections are typed via inference from createCollections()
  private readonly _collections: ReturnType<DurableChatClient['createCollections']>['collections']
  private readonly _collectedMessages: ReturnType<DurableChatClient['createCollections']>['collectedMessages']
  private _isConnected = false
  private _isPaused = false
  private _error: Error | undefined
  private _abortController: AbortController | null = null

  // ═══════════════════════════════════════════════════════════════════════
  // Constructor
  // ═══════════════════════════════════════════════════════════════════════

  constructor(options: DurableChatClientOptions<TTools>) {
    this.options = options
    this.sessionId = options.sessionId
    this.actorId = options.actorId ?? crypto.randomUUID()
    this.actorType = options.actorType ?? 'user'

    // Create collections pipeline
    const { collections, collectedMessages } = this.createCollections()
    this._collections = collections
    this._collectedMessages = collectedMessages

    // Initialize session metadata
    this._collections.sessionMeta.insert(
      createInitialSessionMeta(this.sessionId)
    )
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Collection Setup
  // ═══════════════════════════════════════════════════════════════════════

  private createCollections() {
    const baseUrl = this.options.proxyUrl

    // Create root stream collection (read-only, synced from Durable Streams)
    const stream = createCollection(
      createStreamCollectionOptions({
        sessionId: this.sessionId,
        baseUrl,
        headers: this.options.stream?.headers,
      })
    )

    // Stage 1: Create collected messages (intermediate - groups by messageId)
    const collectedMessages = createCollectedMessagesCollection({
      sessionId: this.sessionId,
      streamCollection: stream,
    })

    // Stage 2: Create materialized messages collection
    const messages = createMessagesCollection({
      sessionId: this.sessionId,
      collectedMessagesCollection: collectedMessages,
    })

    // Derive tool calls from collected messages
    const toolCalls = createToolCallsCollection({
      sessionId: this.sessionId,
      collectedMessagesCollection: collectedMessages,
    })

    // Derive tool results from collected messages
    const toolResults = createToolResultsCollection({
      sessionId: this.sessionId,
      collectedMessagesCollection: collectedMessages,
    })

    // Derive approvals from collected messages
    const approvals = createApprovalsCollection({
      sessionId: this.sessionId,
      collectedMessagesCollection: collectedMessages,
    })

    // Derive active generations from messages
    const activeGenerations = createActiveGenerationsCollection({
      sessionId: this.sessionId,
      messagesCollection: messages,
    })

    // Create session metadata collection (local state)
    const sessionMeta = createCollection(
      createSessionMetaCollectionOptions({
        sessionId: this.sessionId,
      })
    )

    // Create session participants collection (derived from stream)
    const sessionParticipants = createSessionParticipantsCollection({
      sessionId: this.sessionId,
      streamCollection: stream,
    })

    // Create session statistics collection (derived from stream)
    const sessionStats = createSessionStatsCollection({
      sessionId: this.sessionId,
      streamCollection: stream,
    })

    return {
      collections: {
        stream,
        messages,
        toolCalls,
        toolResults,
        approvals,
        activeGenerations,
        sessionParticipants,
        sessionMeta,
        sessionStats,
      },
      collectedMessages,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Core API (TanStack AI ChatClient compatible)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get all messages as UIMessage array.
   * Messages are accessed directly from the materialized collection.
   */
  get messages(): UIMessage[] {
    // Convert MessageRow to UIMessage
    return [...this._collections.messages.values()].map((row) =>
      this.messageRowToUIMessage(row)
    )
  }

  /**
   * Check if any generation is currently active.
   * Uses the activeGenerations collection size directly.
   */
  get isLoading(): boolean {
    return this._collections.activeGenerations.size > 0
  }

  /**
   * Get the current error, if any.
   */
  get error(): Error | undefined {
    return this._error
  }

  /**
   * Send a user message and trigger agent response.
   *
   * @param content - Text content to send
   */
  async sendMessage(content: string): Promise<void> {
    const messageId = crypto.randomUUID()

    try {
      // Post the message to the proxy, which will write to the durable stream
      const response = await fetch(
        `${this.options.proxyUrl}/v1/sessions/${this.sessionId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageId,
            content,
            role: 'user',
            actorId: this.actorId,
            actorType: this.actorType,
          }),
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to send message: ${response.status} ${errorText}`)
      }

      // Wait for sync - the message will appear in the messages collection
      await waitForKey(this._collections.messages, messageId)

      // Notify callback
      this.options.onMessagesChange?.(this.messages)
    } catch (error) {
      this._error = error instanceof Error ? error : new Error(String(error))
      this.options.onError?.(this._error)
      throw error
    }
  }

  /**
   * Append a message to the conversation.
   *
   * @param message - UIMessage or ModelMessage to append
   */
  async append(message: UIMessage | { role: string; content: string }): Promise<void> {
    // Normalize to content string
    const content =
      'parts' in message
        ? extractTextContent(message as MessageRow)
        : (message as { content: string }).content

    const role = message.role

    if (role === 'user') {
      await this.sendMessage(content)
    } else {
      // For non-user messages, post directly to proxy
      const messageId = crypto.randomUUID()

      const response = await fetch(
        `${this.options.proxyUrl}/v1/sessions/${this.sessionId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageId,
            content,
            role,
            actorId: this.actorId,
            actorType: this.actorType,
          }),
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to append message: ${response.status} ${errorText}`)
      }

      // Wait for sync
      await waitForKey(this._collections.messages, messageId)

      this.options.onMessagesChange?.(this.messages)
    }
  }

  /**
   * Reload the last user message and regenerate response.
   */
  async reload(): Promise<void> {
    const msgs = this.messages
    if (msgs.length === 0) return

    // Find the last user message
    let lastUserMessageIndex = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        lastUserMessageIndex = i
        break
      }
    }

    if (lastUserMessageIndex === -1) return

    // Get content of last user message
    const lastUserMessage = msgs[lastUserMessageIndex]
    const content = extractTextContent(lastUserMessage as unknown as MessageRow)

    // Call regenerate endpoint
    const response = await fetch(
      `${this.options.proxyUrl}/v1/sessions/${this.sessionId}/regenerate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromMessageId: lastUserMessage.id,
          content,
          actorId: this.actorId,
          actorType: this.actorType,
        }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to reload: ${response.status} ${errorText}`)
    }
  }

  /**
   * Stop all active generations.
   */
  stop(): void {
    // Cancel any in-flight requests
    this._abortController?.abort()

    // Call stop endpoint
    fetch(`${this.options.proxyUrl}/v1/sessions/${this.sessionId}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: null }), // null = stop all
    }).catch((err) => {
      console.warn('Failed to stop generation:', err)
    })
  }

  /**
   * Clear all messages (local only - does not affect server).
   */
  clear(): void {
    // Note: This only clears local state, not the durable stream
    // For full clear, use the proxy's clear endpoint
    this.options.onMessagesChange?.([])
  }

  /**
   * Add a tool result.
   *
   * @param result - Tool result to add
   */
  async addToolResult(result: ToolResultInput): Promise<void> {
    const response = await fetch(
      `${this.options.proxyUrl}/v1/sessions/${this.sessionId}/tool-results`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Id': this.actorId,
        },
        body: JSON.stringify({
          toolCallId: result.toolCallId,
          output: result.output,
          error: result.error ?? null,
        }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to add tool result: ${response.status} ${errorText}`)
    }
  }

  /**
   * Add an approval response.
   *
   * @param response - Approval response
   */
  async addToolApprovalResponse(response: ApprovalResponseInput): Promise<void> {
    const res = await fetch(
      `${this.options.proxyUrl}/v1/sessions/${this.sessionId}/approvals/${response.id}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Id': this.actorId,
        },
        body: JSON.stringify({
          approved: response.approved,
        }),
      }
    )

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Failed to respond to approval: ${res.status} ${errorText}`)
    }
  }

  /**
   * Manually set messages (for hydration or manual override).
   *
   * @param messages - Messages to set
   */
  setMessagesManually(messages: UIMessage[]): void {
    // This is primarily for SSR hydration or testing
    // In production, messages should come from the durable stream
    this.options.onMessagesChange?.(messages)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Collections
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get all collections for custom queries.
   * All collections contain fully materialized objects.
   */
  get collections() {
    return this._collections
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Durable-specific features
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get current connection status.
   */
  get connectionStatus(): ConnectionStatus {
    const meta = this._collections.sessionMeta.get(this.sessionId)
    return meta?.connectionStatus ?? 'disconnected'
  }

  /**
   * Fork session at a message boundary.
   *
   * @param options - Fork options
   * @returns New session info
   */
  async fork(options?: ForkOptions): Promise<ForkResult> {
    const response = await fetch(
      `${this.options.proxyUrl}/v1/sessions/${this.sessionId}/fork`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          atMessageId: options?.atMessageId ?? null,
          newSessionId: options?.newSessionId ?? null,
        }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to fork session: ${response.status} ${errorText}`)
    }

    return response.json()
  }

  /**
   * Register agents to respond to session messages.
   *
   * @param agents - Agent specifications
   */
  async registerAgents(agents: AgentSpec[]): Promise<void> {
    const response = await fetch(
      `${this.options.proxyUrl}/v1/sessions/${this.sessionId}/agents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to register agents: ${response.status} ${errorText}`)
    }
  }

  /**
   * Unregister an agent.
   *
   * @param agentId - Agent identifier
   */
  async unregisterAgent(agentId: string): Promise<void> {
    const response = await fetch(
      `${this.options.proxyUrl}/v1/sessions/${this.sessionId}/agents/${agentId}`,
      {
        method: 'DELETE',
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to unregister agent: ${response.status} ${errorText}`)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Connect to the durable stream and start syncing.
   */
  async connect(): Promise<void> {
    if (this._isConnected) return

    this._abortController = new AbortController()

    // Update connection status
    this.updateSessionMeta((meta) =>
      updateConnectionStatus(meta, 'connecting')
    )

    try {
      // Create or get the session on the server
      const response = await fetch(
        `${this.options.proxyUrl}/v1/sessions/${this.sessionId}`,
        {
          method: 'PUT',
          headers: this.options.stream?.headers,
          signal: this._abortController.signal,
        }
      )

      if (!response.ok && response.status !== 200 && response.status !== 201) {
        throw new Error(`Failed to create session: ${response.status}`)
      }

      // Start the stream collection sync
      // The collection handles the actual stream following
      this._isConnected = true
      this._isPaused = false

      // Update connection status
      this.updateSessionMeta((meta) => updateConnectionStatus(meta, 'connected'))

      // Subscribe to stream changes to track sync progress
      this._collections.stream.subscribeChanges((changes) => {
        if (changes.length > 0) {
          const lastChange = changes[changes.length - 1]
          if (lastChange.type === 'insert') {
            const row = lastChange.value as StreamRowWithOffset
            this.updateSessionMeta((meta) => updateSyncProgress(meta, row.offset))
          }
        }
      })
    } catch (error) {
      this._error = error instanceof Error ? error : new Error(String(error))
      this.updateSessionMeta((meta) =>
        updateConnectionStatus(meta, 'error', {
          message: this._error!.message,
        })
      )
      this.options.onError?.(this._error)
      throw error
    }
  }

  /**
   * Pause stream sync.
   */
  pause(): void {
    this._isPaused = true
    // The collection will handle pausing internally
  }

  /**
   * Resume stream sync.
   */
  async resume(): Promise<void> {
    if (!this._isConnected) {
      await this.connect()
      return
    }

    this._isPaused = false
    // The collection will handle resuming internally
  }

  /**
   * Disconnect from the stream.
   */
  disconnect(): void {
    this._abortController?.abort()
    this._isConnected = false
    this._isPaused = false

    this.updateSessionMeta((meta) =>
      updateConnectionStatus(meta, 'disconnected')
    )
  }

  /**
   * Dispose the client and clean up resources.
   */
  dispose(): void {
    this.disconnect()
    // Clean up database and collections
    // The database will handle cleanup of collections
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Convert MessageRow to UIMessage.
   */
  private messageRowToUIMessage(row: MessageRow): UIMessage {
    return {
      id: row.id,
      role: row.role as 'user' | 'assistant',
      parts: row.parts,
      createdAt: row.createdAt,
    }
  }

  /**
   * Update session metadata.
   */
  private updateSessionMeta(
    updater: (meta: SessionMetaRow) => SessionMetaRow
  ): void {
    const current = this._collections.sessionMeta.get(this.sessionId)
    if (current) {
      const updated = updater(current)
      this._collections.sessionMeta.update(this.sessionId, (draft) => {
        Object.assign(draft, updated)
      })
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Factory Function
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new DurableChatClient instance.
 *
 * @param options - Client options
 * @returns New client instance
 */
export function createDurableChatClient<
  TTools extends ReadonlyArray<AnyClientTool> = AnyClientTool[],
>(options: DurableChatClientOptions<TTools>): DurableChatClient<TTools> {
  return new DurableChatClient(options)
}
