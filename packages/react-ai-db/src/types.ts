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
> extends DurableChatClientOptions<TTools> {
  /**
   * Whether to automatically connect on mount.
   * @default true
   */
  autoConnect?: boolean
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

  /** Manually set messages (for hydration) */
  setMessages: (messages: UIMessage[]) => void

  /** Add a tool result */
  addToolResult: (result: ToolResultInput) => Promise<void>

  /** Add an approval response */
  addToolApprovalResponse: (response: ApprovalResponseInput) => Promise<void>

  // ═══════════════════════════════════════════════════════════════════════
  // Durable extensions
  // ═══════════════════════════════════════════════════════════════════════

  /** The underlying DurableChatClient instance */
  client: DurableChatClient<TTools>

  /** All collections for custom queries */
  collections: DurableChatCollections

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
