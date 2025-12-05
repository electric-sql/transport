/**
 * Tool calls collection - derived livequery.
 *
 * Extracts and tracks tool call state from stream rows.
 */

import type {
  Collection,
  LiveQueryCollectionConfig,
  StandardSchemaV1,
} from '@tanstack/db'
import type { StreamRowWithOffset, ToolCallRow } from '../types'
import { extractToolCalls } from '../materialize'

/**
 * Options for creating a tool calls collection.
 */
export interface ToolCallsCollectionOptions {
  /** Session identifier */
  sessionId: string
  /** Stream collection to derive from */
  streamCollection: Collection<StreamRowWithOffset>
  /** Optional schema for validation */
  schema?: StandardSchemaV1<ToolCallRow>
}

/**
 * Creates collection config for the tool calls collection.
 *
 * This is a derived livequery collection that extracts tool calls
 * from stream rows. It tracks the lifecycle of each tool call:
 * - pending: Tool call created, waiting for execution
 * - executing: Tool call being executed
 * - complete: Tool call finished (has result)
 *
 * @example
 * ```typescript
 * import { createToolCallsCollectionOptions } from '@electric-sql/ai-db'
 * import { createCollection } from '@tanstack/db'
 *
 * const toolCallsCollection = createCollection(
 *   createToolCallsCollectionOptions({
 *     sessionId: 'my-session',
 *     streamCollection,
 *   })
 * )
 * ```
 */
export function createToolCallsCollectionOptions(
  options: ToolCallsCollectionOptions
): LiveQueryCollectionConfig<ToolCallRow> {
  const { sessionId, streamCollection, schema } = options

  return {
    id: `session-tool-calls:${sessionId}`,
    schema,
    getKey: (tc) => tc.id,

    // Derived via livequery - extracts tool calls from all stream rows
    query: (q) =>
      q
        .from({ row: streamCollection })
        .fn.select(({ rows }) => {
          const allRows = rows as StreamRowWithOffset[]
          return extractToolCalls(allRows)
        })
        // Flatten the array of tool calls
        .fn.flatMap((toolCalls) => toolCalls),
  }
}

/**
 * Get pending tool calls that need to be executed.
 *
 * @param collection - Tool calls collection
 * @returns Array of pending tool calls
 */
export function getPendingToolCalls(
  collection: Collection<ToolCallRow>
): ToolCallRow[] {
  const result: ToolCallRow[] = []
  for (const tc of collection.values()) {
    if (tc.state === 'pending' || tc.state === 'executing') {
      result.push(tc)
    }
  }
  return result
}

/**
 * Check if a tool call is ready for execution.
 *
 * @param toolCall - Tool call to check
 * @returns Whether the tool call can be executed
 */
export function canExecuteToolCall(toolCall: ToolCallRow): boolean {
  return toolCall.state === 'pending' && toolCall.input !== null
}
