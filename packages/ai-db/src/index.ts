/**
 * @electric-sql/ai-db
 *
 * Framework-agnostic durable chat client backed by TanStack DB and Durable Streams.
 *
 * This package provides:
 * - TanStack AI-compatible API for chat applications
 * - Durable persistence via Durable Streams
 * - Real-time sync across tabs, devices, and users
 * - Multi-agent support with webhook registration
 * - Reactive collections for custom UI needs
 *
 * All derived collections contain fully materialized objects - no helper
 * functions needed. Access data directly from collections.
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
 * // TanStack AI-compatible API
 * await client.sendMessage('Hello!')
 * console.log(client.messages)
 *
 * // Access collections directly (no helper functions needed)
 * for (const message of client.collections.messages.values()) {
 *   console.log(message.id, message.role, message.parts)
 * }
 *
 * // Filter with standard collection methods
 * const pending = [...client.collections.approvals.values()]
 *   .filter(a => a.status === 'pending')
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// Client
// ============================================================================

export { DurableChatClient, createDurableChatClient } from './client'

// ============================================================================
// Types
// ============================================================================

export type {
  // Actor types
  ActorType,

  // Stream protocol types
  StreamRow,
  StreamRowWithOffset,

  // Message types
  MessageRole,
  MessageRow,

  // Active generation types
  ActiveGenerationRow,

  // Tool types
  ToolCallState,
  ToolCallRow,
  ToolResultRow,

  // Approval types
  ApprovalStatus,
  ApprovalRow,

  // Session types
  ConnectionStatus,
  SessionParticipant,
  SessionMetaRow,
  SessionStatsRow,

  // Agent types
  AgentTrigger,
  AgentSpec,

  // Collection types
  DurableChatCollections,

  // Configuration types
  DurableChatClientOptions,
  DurableSessionStreamConfig,

  // Input types
  ToolResultInput,
  ApprovalResponseInput,

  // Fork types
  ForkOptions,
  ForkResult,
} from './types'

// ============================================================================
// Schemas (Zod)
// ============================================================================

export { streamRowSchema, streamRowWithOffsetSchema } from './types'

// ============================================================================
// Collection Configuration
// ============================================================================

export {
  durableSessionStreamOptions,
  getDeduplicationKey,
  getStreamRowKey,
} from './collection'

export {
  // Stream collection
  createStreamCollectionOptions,
  type StreamCollectionOptions,

  // Messages collection (two-stage pipeline)
  createCollectedMessagesCollection,
  createMessagesCollection,
  createMessagesPipeline,
  waitForKey,
  type CollectedMessageRows,
  type CollectedMessagesCollectionOptions,
  type MessagesCollectionOptions,
  type MessagesPipelineOptions,
  type MessagesPipelineResult,

  // Tool calls collection
  createToolCallsCollection,
  type ToolCallsCollectionOptions,

  // Tool results collection
  createToolResultsCollection,
  type ToolResultsCollectionOptions,

  // Approvals collection
  createApprovalsCollection,
  type ApprovalsCollectionOptions,

  // Active generations collection
  createActiveGenerationsCollection,
  type ActiveGenerationsCollectionOptions,

  // Session metadata collection (local state)
  createSessionMetaCollectionOptions,
  createInitialSessionMeta,
  updateConnectionStatus,
  updateSyncProgress,
  type SessionMetaCollectionOptions,

  // Session participants collection
  createSessionParticipantsCollection,
  type SessionParticipantsCollectionOptions,

  // Session statistics collection
  createSessionStatsCollection,
  computeSessionStats,
  createEmptyStats,
  type SessionStatsCollectionOptions,
} from './collections'

// ============================================================================
// Materialization
// ============================================================================

export {
  materializeMessage,
  parseChunk,
  extractToolCalls,
  extractToolResults,
  extractApprovals,
  detectActiveGenerations,
  groupRowsByMessage,
  materializeAllMessages,
  extractTextContent,
  isUserMessage,
  isAssistantMessage,
} from './materialize'
