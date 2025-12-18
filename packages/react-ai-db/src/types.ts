/**
 * React-specific types for @electric-sql/react-ai-db
 */

import type {
  DurableChatClient,
  DurableChatClientOptions,
  DurableChatCollections,
  ConnectionStatus,
  ToolResultInput,
  ApprovalResponseInput,
  ForkOptions,
  ForkResult,
  AgentSpec,
} from '@electric-sql/ai-db'
import type { UIMessage, AnyClientTool } from '@tanstack/ai'

/**
 * Options for the useDurableChat hook.
 */
export interface UseDurableChatOptions<
  TTools extends ReadonlyArray<AnyClientTool> = AnyClientTool[],
> extends Partial<DurableChatClientOptions<TTools>> {
  /**
   * Whether to automatically connect on mount.
   * @default true
   */
  autoConnect?: boolean

  /**
   * Pre-created client instance.
   * If provided, the hook will use this client instead of creating a new one.
   * Useful for testing or when you need to share a client between components.
   */
  client?: DurableChatClient<TTools>
}

/**
 * Return value from useDurableChat hook.
 */
export interface UseDurableChatReturn<
  TTools extends ReadonlyArray<AnyClientTool> = AnyClientTool[],
> {
  // ═══════════════════════════════════════════════════════════════════════
  // TanStack AI useChat compatible
  // ═══════════════════════════════════════════════════════════════════════

  /** All messages in the conversation */
  messages: UIMessage[]

  /** Send a user message */
  sendMessage: (content: string) => Promise<void>

  /** Append a message to the conversation */
  append: (message: UIMessage | { role: string; content: string }) => Promise<void>

  /** Reload and regenerate the last response */
  reload: () => Promise<void>

  /** Stop all active generations */
  stop: () => void

  /** Clear all messages (local only) */
  clear: () => void

  /** Whether any generation is currently active */
  isLoading: boolean

  /** Current error, if any */
  error: Error | undefined

  /** Add a tool result */
  addToolResult: (result: ToolResultInput) => Promise<void>

  /** Add an approval response */
  addToolApprovalResponse: (response: ApprovalResponseInput) => Promise<void>

  // ═══════════════════════════════════════════════════════════════════════
  // Durable extensions
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Whether the client is ready (created and available).
   * Use this to check if client/collections are safe to access.
   */
  isReady: boolean

  /**
   * The underlying DurableChatClient instance.
   * May be undefined until the client is created (check isReady first).
   */
  client: DurableChatClient<TTools> | undefined

  /**
   * All collections for custom queries.
   * May be undefined until the client is created (check isReady first).
   */
  collections: DurableChatCollections | undefined

  /** Current connection status */
  connectionStatus: ConnectionStatus

  /** Fork the session at a message boundary */
  fork: (options?: ForkOptions) => Promise<ForkResult>

  /** Register agents to respond to session messages */
  registerAgents: (agents: AgentSpec[]) => Promise<void>

  /** Unregister an agent */
  unregisterAgent: (agentId: string) => Promise<void>

  /** Connect to the stream (if not auto-connected) */
  connect: () => Promise<void>

  /** Disconnect from the stream */
  disconnect: () => void

  /** Pause stream sync */
  pause: () => void

  /** Resume stream sync */
  resume: () => Promise<void>
}
