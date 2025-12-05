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
 * // Custom queries with collections
 * const pendingApprovals = client.collections.approvals.filter(
 *   a => a.status === 'pending'
 * )
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
  DurableMessagesConfig,

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

  // Messages collection
  createMessagesCollectionOptions,
  createUserMessage,
  waitForKey,

  // Tool calls collection
  createToolCallsCollectionOptions,
  getPendingToolCalls,
  canExecuteToolCall,
  type ToolCallsCollectionOptions,

  // Tool results collection
  createToolResultsCollectionOptions,
  getToolResultForCall,
  hasToolResult,
  getFailedToolResults,
  type ToolResultsCollectionOptions,

  // Approvals collection
  createApprovalsCollectionOptions,
  getPendingApprovals,
  getApprovalForToolCall,
  requiresApproval,
  isApproved,
  getApprovalsByStatus,
  type ApprovalsCollectionOptions,

  // Active generations collection
  createActiveGenerationsCollectionOptions,
  hasActiveGeneration,
  getMostRecentActiveGeneration,
  getActiveGenerationsForActor,
  isMessageGenerating,
  type ActiveGenerationsCollectionOptions,

  // Session metadata collection
  createSessionMetaCollectionOptions,
  createInitialSessionMeta,
  extractParticipants,
  updateConnectionStatus,
  updateSyncProgress,
  updateParticipants,
  upsertParticipant,
  type SessionMetaCollectionOptions,

  // Session statistics collection
  createSessionStatsCollectionOptions,
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
