/**
 * @electric-sql/ai-db-proxy
 *
 * Backend proxy for AI DB - Wrapper Protocol implementation for Durable Streams.
 *
 * This package provides a Hono-based HTTP server that implements the AI DB
 * Wrapper Protocol on top of Durable Streams. It handles:
 * - Session management
 * - LLM API proxying with stream teeing
 * - Agent webhook invocation
 * - Tool results and approval flows
 *
 * @example Node.js server
 * ```typescript
 * import { createServer } from '@electric-sql/ai-db-proxy'
 * import { serve } from '@hono/node-server'
 *
 * const { app } = createServer({
 *   baseUrl: 'http://localhost:3000', // Durable Streams server
 * })
 *
 * serve({ fetch: app.fetch, port: 4000 })
 * console.log('AI DB Proxy running on http://localhost:4000')
 * ```
 *
 * @example Cloudflare Workers
 * ```typescript
 * import { createServer } from '@electric-sql/ai-db-proxy'
 *
 * const { app } = createServer({
 *   baseUrl: 'https://streams.example.com',
 *   storage: 'durable-object',
 * })
 *
 * export default app
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// Server
// ============================================================================

export { createServer, type AIDBProxyServerOptions } from './server'
export { default } from './server'

// ============================================================================
// Protocol
// ============================================================================

export { AIDBSessionProtocol } from './protocol'

// ============================================================================
// Types
// ============================================================================

export type {
  ActorType,
  StreamRow,
  AgentTrigger,
  AgentSpec,
  SendMessageRequest,
  SendMessageResponse,
  ToolResultRequest,
  ApprovalResponseRequest,
  RegisterAgentsRequest,
  ForkSessionRequest,
  ForkSessionResponse,
  StopGenerationRequest,
  RegenerateRequest,
  StreamChunk,
  SessionState,
  AIDBProtocolOptions,
} from './types'

// ============================================================================
// Schemas (Zod)
// ============================================================================

export {
  streamRowSchema,
  agentSpecSchema,
  sendMessageRequestSchema,
  toolResultRequestSchema,
  approvalResponseRequestSchema,
  registerAgentsRequestSchema,
  forkSessionRequestSchema,
  stopGenerationRequestSchema,
  regenerateRequestSchema,
} from './types'

// ============================================================================
// Handlers
// ============================================================================

export {
  handleSendMessage,
  handleInvokeAgent,
  handleRegisterAgents,
  handleUnregisterAgent,
  StreamWriter,
  createStreamWriter,
} from './handlers'

// ============================================================================
// Routes
// ============================================================================

export {
  createSessionRoutes,
  createMessageRoutes,
  createAgentRoutes,
  createToolResultRoutes,
  createApprovalRoutes,
  createForkRoutes,
  createHealthRoutes,
} from './routes'
