/**
 * Session statistics collection - two-stage derived pipeline.
 *
 * Computes aggregate statistics from the stream. Uses groupBy + collect
 * to gather all rows, then fn.select to compute the stats.
 *
 * This follows the pattern: aggregate first → materialize second
 */

import { createLiveQueryCollection, collect } from '@tanstack/db'
import type { Collection } from '@tanstack/db'
import type { StreamRowWithOffset, SessionStatsRow, MessageRow } from '../types'
import {
  groupRowsByMessage,
  materializeMessage,
  extractToolCalls,
  extractApprovals,
  detectActiveGenerations,
  parseChunk,
} from '../materialize'

// ============================================================================
// Session Stats Collection
// ============================================================================

/**
 * Intermediate type - collected rows for the session.
 */
interface CollectedSessionRows {
  sessionId: string
  rows: StreamRowWithOffset[]
}

/**
 * Options for creating a session stats collection.
 */
export interface SessionStatsCollectionOptions {
  /** Session identifier */
  sessionId: string
  /** Stream collection to derive stats from */
  streamCollection: Collection<StreamRowWithOffset>
}

/**
 * Creates the session stats collection.
 *
 * Uses a two-stage pipeline:
 * 1. Group all stream rows by sessionId and collect
 * 2. Use fn.select to compute SessionStatsRow from collected rows
 *
 * @example
 * ```typescript
 * const sessionStats = createSessionStatsCollection({
 *   sessionId: 'my-session',
 *   streamCollection,
 * })
 *
 * // Access stats directly
 * const stats = sessionStats.get('my-session')
 * console.log(stats?.messageCount, stats?.toolCallCount)
 * ```
 */
export function createSessionStatsCollection(
  options: SessionStatsCollectionOptions
): Collection<SessionStatsRow> {
  const { sessionId, streamCollection } = options

  // Stage 1: Create intermediate collection with collected rows
  const collectedRows = createLiveQueryCollection((q) =>
    q
      .from({ row: streamCollection })
      .groupBy(() => sessionId)
      .select(({ row }) => ({
        sessionId,
        rows: collect(row),
      }))
  )

  // Stage 2: Compute stats from collected rows
  return createLiveQueryCollection((q) =>
    q
      .from({ collected: collectedRows })
      .fn.select(({ collected }) =>
        computeSessionStats(collected.sessionId, collected.rows)
      )
  )
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
  if (rows.length === 0) {
    return createEmptyStats(sessionId)
  }

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
    const usage = (
      chunk as {
        usage?: {
          totalTokens?: number
          promptTokens?: number
          completionTokens?: number
          total_tokens?: number
          prompt_tokens?: number
          completion_tokens?: number
        }
      }
    ).usage

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
