/**
 * @electric-sql/react-ai-db
 *
 * React bindings for durable chat client backed by TanStack DB and Durable Streams.
 *
 * This package provides React hooks for building durable chat applications with:
 * - TanStack AI-compatible API (drop-in replacement for useChat)
 * - Automatic React state management
 * - Access to reactive collections for custom queries
 * - Multi-agent support
 *
 * @example
 * ```typescript
 * import { useDurableChat } from '@electric-sql/react-ai-db'
 *
 * function Chat() {
 *   const { messages, sendMessage, isLoading } = useDurableChat({
 *     sessionId: 'my-session',
 *     proxyUrl: 'http://localhost:4000',
 *   })
 *
 *   return (
 *     <div>
 *       {messages.map(m => <Message key={m.id} message={m} />)}
 *       <Input onSubmit={sendMessage} disabled={isLoading} />
 *     </div>
 *   )
 * }
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// Hooks
// ============================================================================

export { useDurableChat } from './use-durable-chat'

// ============================================================================
// Types
// ============================================================================

export type { UseDurableChatOptions, UseDurableChatReturn } from './types'

// ============================================================================
// Re-exports from ai-db
// ============================================================================

export {
  // Client
  DurableChatClient,
  createDurableChatClient,

  // Types
  type ActorType,
  type ChunkRow,
  type MessageRole,
  type MessageRow,
  type ActiveGenerationRow,
  type ToolCallState,
  type ToolCallRow,
  type ToolResultRow,
  type ApprovalStatus,
  type ApprovalRow,
  type ConnectionStatus,
  type SessionMetaRow,
  type SessionStatsRow,
  type AgentTrigger,
  type AgentSpec,
  type DurableChatCollections,
  type DurableChatClientOptions,
  type ToolResultInput,
  type ApprovalResponseInput,
  type ForkOptions,
  type ForkResult,

  // Materialization helpers
  extractTextContent,
  isUserMessage,
  isAssistantMessage,
} from '@electric-sql/ai-db'
