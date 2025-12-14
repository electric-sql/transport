/**
 * Tool calls collection - two-stage derived pipeline.
 *
 * Stage 1: collectedByMessage - groups stream rows by messageId using collect()
 * Stage 2: toolCalls - extracts ToolCallRow objects using fn.select, one per tool call
 *
 * This follows the pattern: aggregate first → materialize second
 *
 * Note: Tool calls are extracted from the collectedMessages intermediate collection
 * since tool call chunks are associated with messages.
 */

import { createLiveQueryCollection } from '@tanstack/db'
import type { Collection } from '@tanstack/db'
import type { ToolCallRow } from '../types'
import { extractToolCalls } from '../materialize'
import type { CollectedMessageRows } from './messages'

// ============================================================================
// Tool Calls Collection
// ============================================================================

/**
 * Options for creating a tool calls collection.
 */
export interface ToolCallsCollectionOptions {
  /** Session identifier */
  sessionId: string
  /** Collected messages collection (intermediate from messages pipeline) */
  collectedMessagesCollection: Collection<CollectedMessageRows>
}

/**
 * Creates the tool calls collection from collected messages.
 *
 * Uses fn.select to extract tool calls from each message's collected rows,
 * then flattens them into individual ToolCallRow entries.
 *
 * @example
 * ```typescript
 * const toolCalls = createToolCallsCollection({
 *   sessionId: 'my-session',
 *   collectedMessagesCollection,
 * })
 *
 * // Access tool calls directly
 * for (const toolCall of toolCalls.values()) {
 *   console.log(toolCall.id, toolCall.name, toolCall.state)
 * }
 * ```
 */
export function createToolCallsCollection(
  options: ToolCallsCollectionOptions
): Collection<ToolCallRow> {
  const { collectedMessagesCollection } = options

  // Extract tool calls from each message's collected rows
  // fn.select can return an array which will be flattened
  // Order by startedAt to ensure chronological message ordering
  // startSync: true ensures the collection starts syncing immediately.
  return createLiveQueryCollection({
    query: (q) =>
      q
        .from({ collected: collectedMessagesCollection })
        .orderBy(({ collected }) => collected.startedAt, 'asc')
        .fn.select(({ collected }) => extractToolCalls(collected.rows)),
    startSync: true,
  })
}
