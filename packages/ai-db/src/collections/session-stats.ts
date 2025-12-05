/**
 * Session statistics collection - derived livequery.
 *
 * Aggregate statistics derived from other collections.
 */

import type {
  Collection,
  LiveQueryCollectionConfig,
  StandardSchemaV1,
} from '@tanstack/db'
import type {
  StreamRowWithOffset,
  SessionStatsRow,
  MessageRow,
  ToolCallRow,
  ApprovalRow,
  ActiveGenerationRow,
} from '../types'
import {
  groupRowsByMessage,
  materializeMessage,
  extractToolCalls,
  extractApprovals,
  detectActiveGenerations,
  parseChunk,
} from '../materialize'

/**
 * Options for creating a session stats collection.
 */
export interface SessionStatsCollectionOptions {
  /** Session identifier */
  sessionId: string
  /** Stream collection to derive stats from */
  streamCollection: Collection<StreamRowWithOffset>
  /** Optional schema for validation */
  schema?: StandardSchemaV1<SessionStatsRow>
}

/**
 * Creates collection config for the session statistics collection.
 *
 * This is a derived livequery collection that computes aggregate
 * statistics from the stream data. It's a single-row collection
 * that updates as the stream changes.
 *
 * @example
 * ```typescript
 * import { createSessionStatsCollectionOptions } from '@electric-sql/ai-db'
 * import { createCollection } from '@tanstack/db'
 *
 * const sessionStatsCollection = createCollection(
 *   createSessionStatsCollectionOptions({
 *     sessionId: 'my-session',
 *     streamCollection,
 *   })
 * )
 * ```
 */
export function createSessionStatsCollectionOptions(
  options: SessionStatsCollectionOptions
): LiveQueryCollectionConfig<SessionStatsRow> {
  const { sessionId, streamCollection, schema } = options

  return {
    id: `session-stats:${sessionId}`,
    schema,
    getKey: (stats) => stats.sessionId,

    // Derived via livequery - computes aggregate statistics
    query: (q) =>
      q
        .from({ row: streamCollection })
        .fn.select(({ rows }) => {
          const allRows = rows as StreamRowWithOffset[]
          return [computeSessionStats(sessionId, allRows)]
        })
        .fn.flatMap((stats) => stats),
  }
}

/**
 * Compute session statistics from stream rows.
 *
 * @param sessionId - Session identifier
 * @param rows - All stream rows
 * @returns Computed statistics
 */
export function computeSessionStats(
  sessionId: string,
  rows: StreamRowWithOffset[]
): SessionStatsRow {
  // Group rows by message
  const grouped = groupRowsByMessage(rows)

  // Materialize messages for counting
  const messages: MessageRow[] = []
  for (const [, messageRows] of grouped) {
    try {
      messages.push(materializeMessage(messageRows))
    } catch {
      // Skip invalid messages
    }
  }

  // Count message types
  let userMessageCount = 0
  let assistantMessageCount = 0
  let firstMessageAt: Date | null = null
  let lastMessageAt: Date | null = null

  for (const msg of messages) {
    if (msg.role === 'user') {
      userMessageCount++
    } else if (msg.role === 'assistant') {
      assistantMessageCount++
    }

    if (!firstMessageAt || msg.createdAt < firstMessageAt) {
      firstMessageAt = msg.createdAt
    }
    if (!lastMessageAt || msg.createdAt > lastMessageAt) {
      lastMessageAt = msg.createdAt
    }
  }

  // Extract tool calls and approvals
  const toolCalls = extractToolCalls(rows)
  const approvals = extractApprovals(rows)
  const activeGenerations = detectActiveGenerations(grouped)

  // Extract token usage from chunks
  const { totalTokens, promptTokens, completionTokens } = extractTokenUsage(rows)

  return {
    sessionId,
    messageCount: messages.length,
    userMessageCount,
    assistantMessageCount,
    toolCallCount: toolCalls.length,
    approvalCount: approvals.length,
    totalTokens,
    promptTokens,
    completionTokens,
    activeGenerationCount: activeGenerations.length,
    firstMessageAt,
    lastMessageAt,
  }
}

/**
 * Extract token usage from stream rows.
 *
 * @param rows - Stream rows to extract from
 * @returns Token usage counts
 */
function extractTokenUsage(rows: StreamRowWithOffset[]): {
  totalTokens: number
  promptTokens: number
  completionTokens: number
} {
  let totalTokens = 0
  let promptTokens = 0
  let completionTokens = 0

  for (const row of rows) {
    const chunk = parseChunk(row.chunk)
    if (!chunk) continue

    // Look for usage information in chunks
    const usage = (chunk as { usage?: {
      totalTokens?: number
      promptTokens?: number
      completionTokens?: number
      total_tokens?: number
      prompt_tokens?: number
      completion_tokens?: number
    } }).usage

    if (usage) {
      // Handle both camelCase and snake_case formats
      totalTokens += usage.totalTokens ?? usage.total_tokens ?? 0
      promptTokens += usage.promptTokens ?? usage.prompt_tokens ?? 0
      completionTokens += usage.completionTokens ?? usage.completion_tokens ?? 0
    }
  }

  return { totalTokens, promptTokens, completionTokens }
}

/**
 * Create empty session statistics.
 *
 * @param sessionId - Session identifier
 * @returns Empty statistics row
 */
export function createEmptyStats(sessionId: string): SessionStatsRow {
  return {
    sessionId,
    messageCount: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    toolCallCount: 0,
    approvalCount: 0,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    activeGenerationCount: 0,
    firstMessageAt: null,
    lastMessageAt: null,
  }
}
