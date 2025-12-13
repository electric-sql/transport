/**
 * Core type definitions for @electric-sql/ai-db
 *
 * Defines the stream protocol types, collection schemas, and API interfaces.
 */

import { z } from 'zod'
import type {
  StreamChunk,
  UIMessage,
  MessagePart,
  AnyClientTool,
} from '@tanstack/ai'
import type { Collection } from '@tanstack/db'
import type { StandardSchemaV1 } from '@standard-schema/spec'

// ============================================================================
// Stream Protocol Types
// ============================================================================

/**
 * Complete user message chunk - stored as single row in stream.
 * Used for messages that are complete when written (user input, cached messages).
 *
 * This is different from TanStack AI's StreamChunk types, which are designed
 * for streaming assistant responses. User messages are complete when sent,
 * so we store them as complete UIMessage objects.
 */
export interface UserMessageChunk {
  type: 'user-message'
  message: UIMessage
}

/**
 * Union of all chunk types we handle.
 * - UserMessageChunk: Complete messages (user input)
 * - StreamChunk: TanStack AI streaming chunks (assistant responses)
 */
export type DurableStreamChunk = UserMessageChunk | StreamChunk

/**
 * Actor types in the chat session.
 */
export type ActorType = 'user' | 'agent'

/**
 * A minimal envelope for routing and grouping. Chunk content is opaque to the protocol.
 */
export interface StreamRow {
  /** Session identifier */
  sessionId: string
  /** Message identifier */
  messageId: string
  /** Actor identifier (auto-generated if not provided) */
  actorId: string
  /** Actor type */
  actorType: ActorType
  /** JSON-encoded TanStack AI StreamChunk (opaque to protocol) */
  chunk: string
  /** ISO 8601 timestamp */
  createdAt: string
  /** Sequence within message (for deduplication on resume) */
  seq: number
}

/**
 * StreamRow extended with offset after client reads from stream.
 */
export interface StreamRowWithOffset extends StreamRow {
  /** Attached by client from result.offset (batch-level) */
  offset: string
}

// Zod schemas for validation
export const streamRowSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  actorId: z.string(),
  actorType: z.enum(['user', 'agent']),
  chunk: z.string(),
  createdAt: z.string(),
  seq: z.number(),
})

export const streamRowWithOffsetSchema = streamRowSchema.extend({
  offset: z.string(),
})

// ============================================================================
// Message Collection Types
// ============================================================================

/**
 * Message role types.
 */
export type MessageRole = 'user' | 'assistant' | 'system'

/**
 * Materialized message row from stream.
 */
export interface MessageRow {
  /** Message identifier (same as messageId from stream) */
  id: string
  /** Message role */
  role: MessageRole
  /** Materialized message parts from parsed chunks */
  parts: MessagePart[]
  /** Actor identifier */
  actorId: string
  /** Actor type */
  actorType: ActorType
  /** Whether the finish chunk has been received */
  isComplete: boolean
  /** First chunk offset (for forking) */
  startOffset: string
  /** Last chunk offset (null if still streaming) */
  endOffset: string | null
  /** Message creation timestamp */
  createdAt: Date
}

// ============================================================================
// Active Generation Types
// ============================================================================

/**
 * Messages currently being streamed (have chunks but no finish chunk).
 */
export interface ActiveGenerationRow {
  /** The message being generated */
  messageId: string
  /** Actor identifier */
  actorId: string
  /** When generation started */
  startedAt: Date
  /** Streaming progress cursor */
  lastChunkOffset: string
  /** When last chunk was received */
  lastChunkAt: Date
}

// ============================================================================
// Tool Call Types
// ============================================================================

/**
 * Tool call state.
 */
export type ToolCallState = 'pending' | 'executing' | 'complete'

/**
 * Derived tool call row from stream.
 */
export interface ToolCallRow {
  /** Tool call identifier from chunk */
  id: string
  /** Message containing this tool call */
  messageId: string
  /** Tool name */
  name: string
  /** Accumulated JSON string arguments */
  arguments: string
  /** Parsed input (when complete) */
  input: unknown | null
  /** Tool call state */
  state: ToolCallState
  /** Actor identifier */
  actorId: string
  /** Tool call creation timestamp */
  createdAt: Date
}

// ============================================================================
// Tool Result Types
// ============================================================================

/**
 * Derived tool result row from stream.
 */
export interface ToolResultRow {
  /** Result identifier */
  id: string
  /** Associated tool call identifier */
  toolCallId: string
  /** Message containing this result */
  messageId: string
  /** Tool output */
  output: unknown
  /** Error message if failed */
  error: string | null
  /** Actor identifier */
  actorId: string
  /** Result creation timestamp */
  createdAt: Date
}

// ============================================================================
// Approval Types
// ============================================================================

/**
 * Approval status.
 */
export type ApprovalStatus = 'pending' | 'approved' | 'denied'

/**
 * Derived approval row from stream.
 */
export interface ApprovalRow {
  /** Approval identifier from chunk */
  id: string
  /** Associated tool call identifier */
  toolCallId: string
  /** Message containing this approval */
  messageId: string
  /** Approval status */
  status: ApprovalStatus
  /** Actor who requested approval */
  requestedBy: string
  /** When approval was requested */
  requestedAt: Date
  /** Actor who responded to approval */
  respondedBy: string | null
  /** When approval was responded to */
  respondedAt: Date | null
}

// ============================================================================
// Session Metadata Types
// ============================================================================

/**
 * Connection status states.
 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * Session participant information.
 */
export interface SessionParticipant {
  /** Actor identifier */
  actorId: string
  /** Actor type */
  actorType: ActorType
  /** Optional display name */
  name?: string
  /** Last activity timestamp */
  lastSeenAt: Date
}

/**
 * Session metadata row (local state only, not derived).
 */
export interface SessionMetaRow {
  /** Session identifier */
  sessionId: string
  /** Current connection status */
  connectionStatus: ConnectionStatus
  /** Last synced offset */
  lastSyncedOffset: string | null
  /** Last sync timestamp */
  lastSyncedAt: Date | null
  /** Error information if any */
  error: { message: string; code?: string } | null
}

// ============================================================================
// Session Statistics Types
// ============================================================================

/**
 * Aggregate session statistics row.
 */
export interface SessionStatsRow {
  /** Session identifier */
  sessionId: string
  /** Total message count */
  messageCount: number
  /** User message count */
  userMessageCount: number
  /** Assistant message count */
  assistantMessageCount: number
  /** Total tool call count */
  toolCallCount: number
  /** Total approval count */
  approvalCount: number
  /** Total tokens used */
  totalTokens: number
  /** Prompt tokens used */
  promptTokens: number
  /** Completion tokens used */
  completionTokens: number
  /** Currently active generation count */
  activeGenerationCount: number
  /** First message timestamp */
  firstMessageAt: Date | null
  /** Last message timestamp */
  lastMessageAt: Date | null
}

// ============================================================================
// Agent Types
// ============================================================================

/**
 * Agent trigger modes.
 */
export type AgentTrigger = 'all' | 'user-messages'

/**
 * Unified structure for webhook registration and inline agent invocation.
 */
export interface AgentSpec {
  /** Agent identifier */
  id: string
  /** Optional display name */
  name?: string
  /** Endpoint URL the proxy will call */
  endpoint: string
  /** HTTP method */
  method?: 'POST'
  /** Additional headers for agent calls */
  headers?: Record<string, string>
  /** Trigger mode (for registered agents) */
  triggers?: AgentTrigger
  /** Request body template */
  bodyTemplate?: Record<string, unknown>
}


// ============================================================================
// Collection Types
// ============================================================================

/**
 * All collections exposed by DurableChatClient.
 *
 * All derived collections contain fully materialized objects - no helper
 * functions needed to access the data. This is achieved through a two-stage
 * pipeline: aggregate first (groupBy + collect), then materialize (fn.select).
 *
 * Note: The actual types are inferred from the createCollections() method
 * in DurableChatClient. This interface is kept for documentation purposes
 * and for consumers who want to reference the collection types explicitly.
 */
export interface DurableChatCollections {
  /** Root stream collection synced from Durable Stream */
  stream: Collection<StreamRowWithOffset>
  /** Materialized messages (keyed by messageId) */
  messages: Collection<MessageRow>
  /** Active generations - messages currently being streamed (keyed by messageId) */
  activeGenerations: Collection<ActiveGenerationRow>
  /** Materialized tool calls (keyed by toolCallId) */
  toolCalls: Collection<ToolCallRow>
  /** Materialized tool results (keyed by resultId) */
  toolResults: Collection<ToolResultRow>
  /** Materialized approvals (keyed by approvalId) */
  approvals: Collection<ApprovalRow>
  /** Session participants derived from stream (keyed by actorId) */
  sessionParticipants: Collection<SessionParticipant>
  /** Session metadata collection (local state) */
  sessionMeta: Collection<SessionMetaRow>
  /** Session statistics (keyed by sessionId) */
  sessionStats: Collection<SessionStatsRow>
}

// ============================================================================
// Client Configuration Types
// ============================================================================

/**
 * Configuration options for DurableChatClient.
 */
export interface DurableChatClientOptions<
  TTools extends ReadonlyArray<AnyClientTool> = AnyClientTool[],
> {
  /** Session identifier */
  sessionId: string
  /** Proxy URL for API requests */
  proxyUrl: string
  /** Actor identifier (auto-generated if not provided) */
  actorId?: string
  /** Actor type */
  actorType?: ActorType
  /** Client tools */
  tools?: TTools
  /** Initial messages for SSR hydration */
  initialMessages?: UIMessage[]
  /** API endpoint */
  api?: string
  /** Additional request body fields */
  body?: Record<string, unknown>
  /**
   * Default agent to invoke for each user message.
   * For single-agent scenarios, this provides a simpler alternative to registerAgents().
   * The agent spec is sent with each sendMessage request.
   */
  agent?: AgentSpec

  // Callbacks (TanStack AI compatible)
  /** Called when response is received */
  onResponse?: (response?: Response) => void | Promise<void>
  /** Called for each chunk */
  onChunk?: (chunk: StreamChunk) => void
  /** Called when message finishes */
  onFinish?: (message: UIMessage) => void
  /** Called on error */
  onError?: (error: Error) => void
  /** Called when messages change */
  onMessagesChange?: (messages: UIMessage[]) => void

  /** Durable Streams configuration */
  stream?: {
    /** Additional headers for stream requests */
    headers?: Record<string, string>
  }
}

// ============================================================================
// Tool Result Input Types
// ============================================================================

/**
 * Input for adding a tool result.
 */
export interface ToolResultInput {
  /** Tool call identifier */
  toolCallId: string
  /** Tool output */
  output: unknown
  /** Error message if failed */
  error?: string
  /** Client-generated message ID for optimistic updates (auto-generated if not provided) */
  messageId?: string
}

/**
 * Tool result input with required messageId (used internally for optimistic actions).
 */
export type ClientToolResultInput = Required<Pick<ToolResultInput, 'messageId'>> &
  ToolResultInput

/**
 * Input for adding an approval response.
 */
export interface ApprovalResponseInput {
  /** Approval identifier */
  id: string
  /** Whether approved */
  approved: boolean
}

// ============================================================================
// Fork Types
// ============================================================================

/**
 * Options for forking a session.
 */
export interface ForkOptions {
  /** Fork before this message (default: current end) */
  atMessageId?: string
  /** Custom session ID (default: auto-generated) */
  newSessionId?: string
}

/**
 * Result of forking a session.
 */
export interface ForkResult {
  /** New session identifier */
  sessionId: string
  /** Starting offset for new session */
  offset: string
}

// ============================================================================
// Session Stream Configuration Types
// ============================================================================

/**
 * Configuration for creating a session stream collection.
 */
export interface DurableSessionStreamConfig {
  /** Session identifier */
  sessionId: string
  /** Base URL for the proxy */
  baseUrl: string
  /** Initial offset to resume from */
  initialOffset?: string
  /** Additional headers for stream requests */
  headers?: Record<string, string>
  /** Optional schema for validation */
  schema?: StandardSchemaV1<StreamRowWithOffset>
}

