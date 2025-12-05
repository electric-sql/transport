/**
 * DurableChatClient - Framework-agnostic durable chat client.
 *
 * Provides TanStack AI-compatible API backed by Durable Streams
 * with real-time sync and multi-agent support.
 */

import { createCollection, createDatabase } from '@tanstack/db'
import type { Collection, Database } from '@tanstack/db'
import type { UIMessage, StreamChunk, AnyClientTool } from '@tanstack/ai'
import type {
  DurableChatClientOptions,
  DurableChatCollections,
  StreamRowWithOffset,
  MessageRow,
  ActiveGenerationRow,
  ToolCallRow,
  ToolResultRow,
  ApprovalRow,
  SessionMetaRow,
  SessionStatsRow,
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
  createMessagesCollectionOptions,
  createToolCallsCollectionOptions,
  createToolResultsCollectionOptions,
  createApprovalsCollectionOptions,
  createActiveGenerationsCollectionOptions,
  createSessionMetaCollectionOptions,
  createSessionStatsCollectionOptions,
  createInitialSessionMeta,
  updateConnectionStatus,
  updateSyncProgress,
  createUserMessage,
  waitForKey,
  hasActiveGeneration,
} from './collections'
import { extractTextContent } from './materialize'

/**
 * DurableChatClient provides a TanStack AI-compatible chat interface
 * backed by Durable Streams for persistence and real-time sync.
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
 * // Or use collections for custom queries
 * const pendingApprovals = client.collections.approvals.filter(
 *   a => a.status === 'pending'
 * )
 * ```
 */
export class DurableChatClient<
  TTools extends ReadonlyArray<AnyClientTool> = AnyClientTool[],
> {
  readonly sessionId: string
  readonly actorId: string
  readonly actorType: ActorType

  private readonly options: DurableChatClientOptions<TTools>
  private readonly db: Database
  private readonly _collections: DurableChatCollections
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

    // Create database
    this.db = createDatabase()

    // Create collections
    this._collections = this.createCollections()

    // Initialize session metadata
    this._collections.sessionMeta.insert(
      createInitialSessionMeta(this.sessionId)
    )
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Collection Setup
  // ═══════════════════════════════════════════════════════════════════════

  private createCollections(): DurableChatCollections {
    const baseUrl = this.options.proxyUrl

    // Create root stream collection (read-only, synced from Durable Streams)
    const stream = createCollection(
      this.db,
      createStreamCollectionOptions({
        sessionId: this.sessionId,
        baseUrl,
        headers: this.options.stream?.headers,
      })
    )

    // Create derived messages collection (with optimistic mutations)
    const messages = createCollection(
      this.db,
      createMessagesCollectionOptions({
        sessionId: this.sessionId,
        proxyUrl: baseUrl,
        actorId: this.actorId,
        actorType: this.actorType,
        streamCollection: stream,
      })
    )

    // Create derived tool calls collection
    const toolCalls = createCollection(
      this.db,
      createToolCallsCollectionOptions({
        sessionId: this.sessionId,
        streamCollection: stream,
      })
    )

    // Create derived tool results collection
    const toolResults = createCollection(
      this.db,
      createToolResultsCollectionOptions({
        sessionId: this.sessionId,
        streamCollection: stream,
      })
    )

    // Create derived approvals collection
    const approvals = createCollection(
      this.db,
      createApprovalsCollectionOptions({
        sessionId: this.sessionId,
        streamCollection: stream,
      })
    )

    // Create derived active generations collection
    const activeGenerations = createCollection(
      this.db,
      createActiveGenerationsCollectionOptions({
        sessionId: this.sessionId,
        streamCollection: stream,
      })
    )

    // Create session metadata collection
    const sessionMeta = createCollection(
      this.db,
      createSessionMetaCollectionOptions({
        sessionId: this.sessionId,
        streamCollection: stream,
      })
    )

    // Create session statistics collection
    const sessionStats = createCollection(
      this.db,
      createSessionStatsCollectionOptions({
        sessionId: this.sessionId,
        streamCollection: stream,
      })
    )

    return {
      stream,
      messages,
      toolCalls,
      toolResults,
      approvals,
      activeGenerations,
      sessionMeta,
      sessionStats,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Core API (TanStack AI ChatClient compatible)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get all messages as UIMessage array.
   */
  get messages(): UIMessage<TTools>[] {
    const messageRows = Array.from(this._collections.messages.values())
    // Sort by startOffset for chronological order
    messageRows.sort((a, b) => a.startOffset.localeCompare(b.startOffset))

    return messageRows.map((row) => this.messageRowToUIMessage(row))
  }

  /**
   * Check if any generation is currently active.
   */
  get isLoading(): boolean {
    return hasActiveGeneration(this._collections.activeGenerations)
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
    const message = createUserMessage(content, this.actorId, this.actorType)

    try {
      // This triggers optimistic insert → onInsert → POST → await sync
      await this._collections.messages.insert(message)

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
  setMessagesManually(messages: UIMessage<TTools>[]): void {
    // This is primarily for SSR hydration or testing
    // In production, messages should come from the durable stream
    this.options.onMessagesChange?.(messages)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Collections
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get all collections for custom queries.
   */
  get collections(): DurableChatCollections {
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
  private messageRowToUIMessage(row: MessageRow): UIMessage<TTools> {
    return {
      id: row.id,
      role: row.role as 'user' | 'assistant',
      parts: row.parts,
      createdAt: row.createdAt,
    } as UIMessage<TTools>
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
      this._collections.sessionMeta.update(this.sessionId, updated)
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
