/**
 * Type definitions for @electric-sql/ai-db-proxy
 */

import { z } from 'zod'

// ============================================================================
// Stream Row Types
// ============================================================================

/**
 * Actor types in the chat session.
 */
export type ActorType = 'user' | 'agent'

/**
 * A minimal envelope for routing and grouping.
 */
export interface StreamRow {
  sessionId: string
  messageId: string
  actorId: string
  actorType: ActorType
  chunk: string
  createdAt: string
  seq: number
}

// Zod schema for validation
export const streamRowSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  actorId: z.string(),
  actorType: z.enum(['user', 'agent']),
  chunk: z.string(),
  createdAt: z.string(),
  seq: z.number(),
})

// ============================================================================
// Agent Types
// ============================================================================

/**
 * Agent trigger modes.
 */
export type AgentTrigger = 'all' | 'user-messages'

/**
 * Agent specification for webhook registration.
 */
export interface AgentSpec {
  id: string
  name?: string
  endpoint: string
  method?: 'POST'
  headers?: Record<string, string>
  triggers?: AgentTrigger
  bodyTemplate?: Record<string, unknown>
}

// Zod schema for validation
export const agentSpecSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  endpoint: z.string().url(),
  method: z.literal('POST').optional(),
  headers: z.record(z.string(), z.string()).optional(),
  triggers: z.enum(['all', 'user-messages']).optional(),
  bodyTemplate: z.record(z.string(), z.unknown()).optional(),
})

// ============================================================================
// Request Types
// ============================================================================

/**
 * Send message request body.
 */
export interface SendMessageRequest {
  messageId?: string
  content: string
  role?: 'user' | 'assistant' | 'system'
  actorId?: string
  actorType?: ActorType
  agent?: AgentSpec
}

export const sendMessageRequestSchema = z.object({
  messageId: z.string().uuid().optional(),
  content: z.string(),
  role: z.enum(['user', 'assistant', 'system']).optional(),
  actorId: z.string().optional(),
  actorType: z.enum(['user', 'agent']).optional(),
  agent: agentSpecSchema.optional(),
})

/**
 * Tool result request body.
 */
export interface ToolResultRequest {
  toolCallId: string
  output: unknown
  error?: string | null
}

export const toolResultRequestSchema = z.object({
  toolCallId: z.string(),
  output: z.unknown(),
  error: z.string().nullable().optional(),
})

/**
 * Approval response request body.
 */
export interface ApprovalResponseRequest {
  approved: boolean
}

export const approvalResponseRequestSchema = z.object({
  approved: z.boolean(),
})

/**
 * Register agents request body.
 */
export interface RegisterAgentsRequest {
  agents: AgentSpec[]
}

export const registerAgentsRequestSchema = z.object({
  agents: z.array(agentSpecSchema),
})

/**
 * Fork session request body.
 */
export interface ForkSessionRequest {
  atMessageId?: string | null
  newSessionId?: string | null
}

export const forkSessionRequestSchema = z.object({
  atMessageId: z.string().nullable().optional(),
  newSessionId: z.string().uuid().nullable().optional(),
})

/**
 * Stop generation request body.
 */
export interface StopGenerationRequest {
  messageId?: string | null
}

export const stopGenerationRequestSchema = z.object({
  messageId: z.string().nullable().optional(),
})

/**
 * Regenerate request body.
 */
export interface RegenerateRequest {
  fromMessageId: string
  content: string
  actorId?: string
  actorType?: ActorType
}

export const regenerateRequestSchema = z.object({
  fromMessageId: z.string(),
  content: z.string(),
  actorId: z.string().optional(),
  actorType: z.enum(['user', 'agent']).optional(),
})

// ============================================================================
// Response Types
// ============================================================================

/**
 * Send message response.
 */
export interface SendMessageResponse {
  messageId: string
}

/**
 * Fork session response.
 */
export interface ForkSessionResponse {
  sessionId: string
  offset: string
}

// ============================================================================
// Stream Chunk Types (TanStack AI compatible)
// ============================================================================

/**
 * Generic stream chunk type.
 * We keep this opaque on the server side - just JSON encode/decode.
 */
export interface StreamChunk {
  type: string
  [key: string]: unknown
}

// ============================================================================
// Session State Types
// ============================================================================

/**
 * Session metadata stored in wrapper protocol state.
 */
export interface SessionState {
  createdAt: string
  lastActivityAt: string
  agents: AgentSpec[]
  activeGenerations: string[]
}

// ============================================================================
// Protocol Options
// ============================================================================

/**
 * Options for AIDBSessionProtocol.
 */
export interface AIDBProtocolOptions {
  /** Base URL for the Durable Streams server */
  baseUrl: string
  /** Storage implementation ('memory' | 'durable-object' | custom) */
  storage?: 'memory' | 'durable-object'
}
