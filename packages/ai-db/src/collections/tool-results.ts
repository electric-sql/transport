/**
 * Tool results collection - derived livequery.
 *
 * Extracts tool execution results from stream rows.
 */

import type {
  Collection,
  LiveQueryCollectionConfig,
  StandardSchemaV1,
} from '@tanstack/db'
import type { StreamRowWithOffset, ToolResultRow } from '../types'
import { extractToolResults } from '../materialize'

/**
 * Options for creating a tool results collection.
 */
export interface ToolResultsCollectionOptions {
  /** Session identifier */
  sessionId: string
  /** Stream collection to derive from */
  streamCollection: Collection<StreamRowWithOffset>
  /** Optional schema for validation */
  schema?: StandardSchemaV1<ToolResultRow>
}

/**
 * Creates collection config for the tool results collection.
 *
 * This is a derived livequery collection that extracts tool results
 * from stream rows. Each result is linked to its originating tool call
 * via toolCallId.
 *
 * @example
 * ```typescript
 * import { createToolResultsCollectionOptions } from '@electric-sql/ai-db'
 * import { createCollection } from '@tanstack/db'
 *
 * const toolResultsCollection = createCollection(
 *   createToolResultsCollectionOptions({
 *     sessionId: 'my-session',
 *     streamCollection,
 *   })
 * )
 * ```
 */
export function createToolResultsCollectionOptions(
  options: ToolResultsCollectionOptions
): LiveQueryCollectionConfig<ToolResultRow> {
  const { sessionId, streamCollection, schema } = options

  return {
    id: `session-tool-results:${sessionId}`,
    schema,
    getKey: (tr) => tr.id,

    // Derived via livequery - extracts tool results from all stream rows
    query: (q) =>
      q
        .from({ row: streamCollection })
        .fn.select(({ rows }) => {
          const allRows = rows as StreamRowWithOffset[]
          return extractToolResults(allRows)
        })
        // Flatten the array of tool results
        .fn.flatMap((results) => results),
  }
}

/**
 * Get the result for a specific tool call.
 *
 * @param collection - Tool results collection
 * @param toolCallId - Tool call identifier
 * @returns Tool result or undefined
 */
export function getToolResultForCall(
  collection: Collection<ToolResultRow>,
  toolCallId: string
): ToolResultRow | undefined {
  for (const result of collection.values()) {
    if (result.toolCallId === toolCallId) {
      return result
    }
  }
  return undefined
}

/**
 * Check if a tool call has a result.
 *
 * @param collection - Tool results collection
 * @param toolCallId - Tool call identifier
 * @returns Whether the tool call has a result
 */
export function hasToolResult(
  collection: Collection<ToolResultRow>,
  toolCallId: string
): boolean {
  return getToolResultForCall(collection, toolCallId) !== undefined
}

/**
 * Get all failed tool results.
 *
 * @param collection - Tool results collection
 * @returns Array of failed tool results
 */
export function getFailedToolResults(
  collection: Collection<ToolResultRow>
): ToolResultRow[] {
  const result: ToolResultRow[] = []
  for (const tr of collection.values()) {
    if (tr.error !== null) {
      result.push(tr)
    }
  }
  return result
}
