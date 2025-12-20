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
// Schema (STATE-PROTOCOL)
// ============================================================================

export {
  sessionStateSchema,
  chunkValueSchema,
  presenceValueSchema,
  agentValueSchema,
  type SessionStateSchema,
  type ChunkValue,
  type ChunkRow,
  type PresenceValue,
  type PresenceRow,
  type AgentValue,
  type AgentRow,
} from './schema'

// ============================================================================
// Types
// ============================================================================

export type {
  // Actor types
  ActorType,

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
  SessionMetaRow,
  SessionStatsRow,

  // Agent types
  AgentTrigger,
  AgentSpec,

  // Collection types
  DurableChatCollections,

  // Configuration types
  DurableChatClientOptions,
  SessionDBConfig,
  LiveMode,

  // Input types
  ToolResultInput,
  ApprovalResponseInput,

  // Fork types
  ForkOptions,
  ForkResult,
} from './types'

// ============================================================================
// Session DB Factory
// ============================================================================

export {
  createSessionDB,
  getChunkKey,
  parseChunkKey,
  type SessionDB,
} from './collection'

export {
  // Messages collection (two-stage pipeline)
  createCollectedMessagesCollection,
  createMessagesCollection,
  createMessagesPipeline,
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
  messageRowToUIMessage,
} from './materialize'
