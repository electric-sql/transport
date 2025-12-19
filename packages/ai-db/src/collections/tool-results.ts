/**
 * Tool results collection - two-stage derived pipeline.
 *
 * Extracts tool execution results from stream rows, derived from the
 * collectedMessages intermediate collection.
 *
 * This follows the pattern: aggregate first → materialize second
 */

import { createLiveQueryCollection } from '@tanstack/db'
import type { Collection } from '@tanstack/db'
import type { ToolResultRow } from '../types'
import { extractToolResults } from '../materialize'
import type { CollectedMessageRows } from './messages'
import type { ChunkRow } from '../schema'

// ============================================================================
// Tool Results Collection
// ============================================================================

/**
 * Options for creating a tool results collection.
 */
export interface ToolResultsCollectionOptions {
  /** Session identifier */
  sessionId: string
  /** Collected messages collection (intermediate from messages pipeline) */
  collectedMessagesCollection: Collection<CollectedMessageRows>
}

/**
 * Creates the tool results collection from collected messages.
 *
 * Uses fn.select to extract tool results from each message's collected rows,
 * then flattens them into individual ToolResultRow entries.
 *
 * @example
 * ```typescript
 * const toolResults = createToolResultsCollection({
 *   sessionId: 'my-session',
 *   collectedMessagesCollection,
 * })
 *
 * // Access tool results directly
 * for (const result of toolResults.values()) {
 *   console.log(result.toolCallId, result.output)
 * }
 * ```
 */
export function createToolResultsCollection(
  options: ToolResultsCollectionOptions
): Collection<ToolResultRow> {
  const { collectedMessagesCollection } = options

  // Extract tool results from each message's collected rows
  // fn.select can return an array which will be flattened
  // Order by startedAt to ensure chronological message ordering
  return createLiveQueryCollection({
    query: (q) =>
      q
        .from({ collected: collectedMessagesCollection })
        .orderBy(({ collected }) => collected.startedAt, 'asc')
        .fn.select(({ collected }) => extractToolResults(collected.rows)),
  })
}
