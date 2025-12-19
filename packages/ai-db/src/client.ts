/**
 * DurableChatClient - Framework-agnostic durable chat client.
 *
 * Provides TanStack AI-compatible API backed by Durable Streams
 * with real-time sync and multi-agent support.
 *
 * All derived collections contain fully materialized objects.
 * No helper functions needed to access data.
 */

import { createCollection, createOptimisticAction } from '@tanstack/db'
import type { Transaction } from '@tanstack/db'
import type { UIMessage, AnyClientTool } from '@tanstack/ai'
import type { ChunkRow } from './schema'
import type {
  DurableChatClientOptions,
  MessageRow,
  SessionMetaRow,
  AgentSpec,
  ConnectionStatus,
  ForkOptions,
  ForkResult,
  ToolResultInput,
  ClientToolResultInput,
  ApprovalResponseInput,
  ActorType,
} from './types'
import { createSessionDB, getChunkKey, type SessionDB } from './collection'
import {
  createCollectedMessagesCollection,
  createMessagesCollection,
  createToolCallsCollection,
  createToolResultsCollection,
  createApprovalsCollection,
  createActiveGenerationsCollection,
  createSessionMetaCollectionOptions,
  createSessionStatsCollection,
  createInitialSessionMeta,
  updateConnectionStatus,
  updateSyncProgress,
} from './collections'
import { extractTextContent } from './materialize'

/**
 * Unified input for all message optimistic actions.
 */
interface MessageActionInput {
  /** Message content */
  content: string
  /** Client-generated message ID */
  messageId: string
  /** Message role */
  role: 'user' | 'assistant' | 'system'
  /** Optional agent to invoke (for user messages) */
  agent?: AgentSpec
}

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

// Debug: instance counter for tracking client lifecycle
let clientInstanceCounter = 0

export class DurableChatClient<
  TTools extends ReadonlyArray<AnyClientTool> = AnyClientTool[],
> {
  readonly sessionId: string
  readonly actorId: string
  readonly actorType: ActorType

  // Debug: unique instance ID for logging
  private readonly _instanceId: number

  private readonly options: DurableChatClientOptions<TTools>

  // Stream-db instance (created synchronously in constructor)
  // Either from options.sessionDB (tests) or createSessionDB() (production)
  private readonly _db: SessionDB

  // Collections are typed via inference from createCollections()
  // Created synchronously in constructor - always available
  private readonly _collections: ReturnType<DurableChatClient['createCollections']>['collections']
  private readonly _collectedMessages: ReturnType<DurableChatClient['createCollections']>['collectedMessages']

  private _isConnected = false
  private _isPaused = false
  private _error: Error | undefined

  // AbortController created at construction time to pass signal to stream-db.
  // Aborted on disconnect() to cancel the stream sync.
  private readonly _abortController: AbortController

  // Counter for generating unique optimistic sequence numbers
  private _optimisticSeq = 0

  // Optimistic actions for mutations (created synchronously in constructor)
  private readonly _messageAction: (input: MessageActionInput) => Transaction
  private readonly _addToolResultAction: (input: ClientToolResultInput) => Transaction
  private readonly _addApprovalResponseAction: (input: ApprovalResponseInput) => Transaction

  // ═══════════════════════════════════════════════════════════════════════
  // Constructor
  // ═══════════════════════════════════════════════════════════════════════

  constructor(options: DurableChatClientOptions<TTools>) {
    this._instanceId = ++clientInstanceCounter
    this.options = options
    this.sessionId = options.sessionId
    this.actorId = options.actorId ?? crypto.randomUUID()
    this.actorType = options.actorType ?? 'user'

    // Create abort controller before anything else
    this._abortController = new AbortController()

    // Create stream-db synchronously (use injected sessionDB for tests)
    this._db = options.sessionDB ?? createSessionDB({
      sessionId: this.sessionId,
      baseUrl: options.proxyUrl,
      headers: options.stream?.headers,
      signal: this._abortController.signal,
    })

    // Create all collections synchronously (always from _db.collections)
    const { collections, collectedMessages } = this.createCollections()
    this._collections = collections
    this._collectedMessages = collectedMessages

    // Initialize session metadata
    this._collections.sessionMeta.insert(
      createInitialSessionMeta(this.sessionId)
    )

    // Create optimistic actions (they use collections)
    this._messageAction = this.createMessageAction()
    this._addToolResultAction = this.createAddToolResultAction()
    this._addApprovalResponseAction = this.createApprovalResponseAction()
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Collection Setup
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Create all derived collections from the chunks collection.
   *
   * This implements the live query pipeline pattern:
   * chunks → collectedMessages → messages (and other derived collections)
   *
   * CRITICAL: Materialization happens inside fn.select(). No imperative code
   * outside this pattern.
   */
  private createCollections() {
    // Get root collections from stream-db (always available - from real or mock SessionDB)
    const { chunks, presence, agents } = this._db.collections

    // Stage 1: Create collected messages (intermediate - groups by messageId)
    const collectedMessages = createCollectedMessagesCollection({
      sessionId: this.sessionId,
      chunksCollection: chunks,
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

    // Create session statistics collection (derived from chunks)
    const sessionStats = createSessionStatsCollection({
      sessionId: this.sessionId,
      chunksCollection: chunks,
    })

    return {
      collections: {
        chunks,
        presence,
        agents,
        messages,
        toolCalls,
        toolResults,
        approvals,
        activeGenerations,
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
   * Uses optimistic updates for instant UI feedback. The message appears
   * immediately in the UI while the server request is in flight.
   *
   * @param content - Text content to send
   */
  async sendMessage(content: string): Promise<void> {
    if (!this._isConnected) {
      throw new Error('Client not connected. Call connect() first.')
    }

    await this.executeAction(this._messageAction, {
      content,
      messageId: crypto.randomUUID(),
      role: 'user',
      agent: this.options.agent,
    })
  }

  /**
   * Append a message to the conversation.
   *
   * Uses optimistic updates for instant UI feedback.
   * For user messages, this triggers agent response if an agent is configured.
   *
   * @param message - UIMessage or ModelMessage to append
   */
  async append(message: UIMessage | { role: string; content: string }): Promise<void> {
    if (!this._isConnected) {
      throw new Error('Client not connected. Call connect() first.')
    }

    const content =
      'parts' in message
        ? extractTextContent(message as MessageRow)
        : (message as { content: string }).content

    const role = message.role as 'user' | 'assistant' | 'system'
    const messageId = 'id' in message ? message.id : crypto.randomUUID()

    await this.executeAction(this._messageAction, {
      content,
      messageId,
      role,
      agent: role === 'user' ? this.options.agent : undefined,
    })
  }

  /**
   * Execute an optimistic action with unified error handling.
   */
  private async executeAction<T>(
    action: (input: T) => Transaction,
    input: T
  ): Promise<void> {
    try {
      const transaction = action(input)
      await transaction.isPersisted.promise
    } catch (error) {
      this._error = error instanceof Error ? error : new Error(String(error))
      this.options.onError?.(this._error)
      throw error
    }
  }

  /**
   * POST JSON to proxy endpoint with error handling.
   */
  private async postToProxy(
    path: string,
    body: Record<string, unknown>,
    options?: { actorIdHeader?: boolean }
  ): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (options?.actorIdHeader) {
      headers['X-Actor-Id'] = this.actorId
    }

    const response = await fetch(
      `${this.options.proxyUrl}${path}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Request failed: ${response.status} ${errorText}`)
    }
  }

  /**
   * Create the unified optimistic action for all message types.
   * Handles user, assistant, and system messages with the same pattern.
   *
   * IMPORTANT: We insert into the chunks collection (not the messages collection)
   * because messages is a derived collection from a live query pipeline. Inserting
   * directly into a derived collection causes TanStack DB reconciliation bugs where
   * synced data becomes invisible while the optimistic mutation is pending.
   *
   * By inserting into the chunks collection with the whole-message format, the
   * optimistic row flows through the normal pipeline: chunks → collectedMessages → messages.
   */
  private createMessageAction() {
    return createOptimisticAction<MessageActionInput>({
      onMutate: ({ content, messageId, role }) => {
        // For optimistic inserts, we use seq=0 since user messages are single-chunk.
        // The key format is `${messageId}:${seq}`.
        const seq = 0
        const id = getChunkKey(messageId, seq)

        const createdAt = new Date()

        // Insert into chunks collection with whole-message format.
        // This flows through the live query pipeline: chunks → collectedMessages → messages
        this._collections.chunks.insert({
          id,
          messageId,
          actorId: this.actorId,
          role,
          chunk: JSON.stringify({
            type: 'whole-message',
            message: {
              id: messageId,
              role,
              parts: [{ type: 'text' as const, content }],
              createdAt: createdAt.toISOString(),
            },
          }),
          createdAt: createdAt.toISOString(),
          seq,
        })
      },
      mutationFn: async ({ content, messageId, role, agent }) => {
        const txid = crypto.randomUUID()

        await this.postToProxy(`/v1/sessions/${this.sessionId}/messages`, {
          messageId,
          content,
          role,
          actorId: this.actorId,
          actorType: this.actorType,
          txid,
          ...(agent && { agent }),
        })

        // Wait for txid to appear in synced stream
        await this._db.utils.awaitTxId(txid)
      },
    })
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
   * Uses optimistic updates for instant UI feedback.
   *
   * @param result - Tool result to add
   */
  async addToolResult(result: ToolResultInput): Promise<void> {
    if (!this._isConnected) {
      throw new Error('Client not connected. Call connect() first.')
    }

    // Ensure messageId is set for optimistic updates
    const inputWithMessageId: ClientToolResultInput = {
      ...result,
      messageId: result.messageId ?? crypto.randomUUID(),
    }
    await this.executeAction(this._addToolResultAction, inputWithMessageId)
  }

  /**
   * Create the optimistic action for adding tool results.
   *
   * Uses client-generated messageId for predictable tool result IDs,
   * enabling proper optimistic updates.
   */
  private createAddToolResultAction() {
    return createOptimisticAction<ClientToolResultInput>({
      onMutate: ({ messageId, toolCallId, output, error }) => {
        const resultId = `${messageId}:${toolCallId}`
        this._collections.toolResults.insert({
          id: resultId,
          toolCallId,
          messageId,
          output,
          error: error ?? null,
          actorId: this.actorId,
          createdAt: new Date(),
        })
      },
      mutationFn: async ({ messageId, toolCallId, output, error }) => {
        const txid = crypto.randomUUID()

        await this.postToProxy(
          `/v1/sessions/${this.sessionId}/tool-results`,
          { messageId, toolCallId, output, error: error ?? null, txid },
          { actorIdHeader: true }
        )

        // Wait for txid to appear in synced stream
        await this._db.utils.awaitTxId(txid)
      },
    })
  }

  /**
   * Add an approval response.
   *
   * Uses optimistic updates for instant UI feedback.
   *
   * @param response - Approval response
   */
  async addToolApprovalResponse(response: ApprovalResponseInput): Promise<void> {
    if (!this._isConnected) {
      throw new Error('Client not connected. Call connect() first.')
    }

    await this.executeAction(this._addApprovalResponseAction, response)
  }

  /**
   * Create the optimistic action for approval responses.
   *
   * Note: We use optimistic updates for approvals since we're updating
   * an existing row (not inserting). The approval ID is known client-side.
   * The optimistic update provides instant feedback while the server
   * processes the response.
   */
  private createApprovalResponseAction() {
    return createOptimisticAction<ApprovalResponseInput>({
      onMutate: ({ id, approved }) => {
        const approval = this._collections.approvals.get(id)
        if (approval) {
          this._collections.approvals.update(id, (draft) => {
            draft.status = approved ? 'approved' : 'denied'
            draft.respondedBy = this.actorId
            draft.respondedAt = new Date()
          })
        }
      },
      mutationFn: async ({ id, approved }) => {
        const txid = crypto.randomUUID()

        await this.postToProxy(
          `/v1/sessions/${this.sessionId}/approvals/${id}`,
          { approved, txid },
          { actorIdHeader: true }
        )

        // Wait for txid to appear in synced stream
        await this._db.utils.awaitTxId(txid)
      },
    })
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Collections
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get all collections for custom queries.
   * All collections contain fully materialized objects.
   * Collections are available immediately after construction.
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
   *
   * This method handles network operations only - collections are already
   * created synchronously in the constructor and are immediately available.
   */
  async connect(): Promise<void> {
    if (this._isConnected) return

    try {
      // Update connection status
      this.updateSessionMeta((meta) =>
        updateConnectionStatus(meta, 'connecting')
      )

      // Skip server call when using injected sessionDB (test mode)
      // This allows tests to use connect() without needing a real server
      if (!this.options.sessionDB) {
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
      }

      // Preload stream data (works for both real and mock sessionDB)
      await this._db.preload()

      this._isConnected = true
      this._isPaused = false

      // Update connection status
      this.updateSessionMeta((meta) => updateConnectionStatus(meta, 'connected'))

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
    // The stream-db handles pausing internally via the abort signal
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
    // The stream-db handles resuming internally
  }

  /**
   * Disconnect from the stream.
   */
  disconnect(): void {
    // Close stream-db (which aborts the stream)
    this._db.close()

    this._abortController.abort()
    this._isConnected = false
    this._isPaused = false

    this.updateSessionMeta((meta) =>
      updateConnectionStatus(meta, 'disconnected')
    )
  }

  /**
   * Dispose the client and clean up resources.
   *
   * Note: We only disconnect here - we don't manually cleanup collections.
   * All exposed collections could be used by application code via useLiveQuery,
   * and manual cleanup would error: "Source collection was manually cleaned up
   * while live query depends on it."
   *
   * TanStack DB will GC collections automatically when they have no subscribers.
   */
  dispose(): void {
    this.disconnect()
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
