/**
 * Active generations collection - derived livequery.
 *
 * Tracks messages that are currently being streamed (have chunks but no finish chunk).
 */

import type {
  Collection,
  LiveQueryCollectionConfig,
  StandardSchemaV1,
} from '@tanstack/db'
import type { StreamRowWithOffset, ActiveGenerationRow } from '../types'
import { groupRowsByMessage, detectActiveGenerations } from '../materialize'

/**
 * Options for creating an active generations collection.
 */
export interface ActiveGenerationsCollectionOptions {
  /** Session identifier */
  sessionId: string
  /** Stream collection to derive from */
  streamCollection: Collection<StreamRowWithOffset>
  /** Optional schema for validation */
  schema?: StandardSchemaV1<ActiveGenerationRow>
}

/**
 * Creates collection config for the active generations collection.
 *
 * This is a derived livequery collection that detects incomplete messages
 * (messages that have started streaming but haven't received a finish chunk yet).
 *
 * Active generations are useful for:
 * - Showing typing indicators
 * - Tracking streaming progress
 * - Resuming interrupted generations
 *
 * @example
 * ```typescript
 * import { createActiveGenerationsCollectionOptions } from '@electric-sql/ai-db'
 * import { createCollection } from '@tanstack/db'
 *
 * const activeGenerationsCollection = createCollection(
 *   createActiveGenerationsCollectionOptions({
 *     sessionId: 'my-session',
 *     streamCollection,
 *   })
 * )
 * ```
 */
export function createActiveGenerationsCollectionOptions(
  options: ActiveGenerationsCollectionOptions
): LiveQueryCollectionConfig<ActiveGenerationRow> {
  const { sessionId, streamCollection, schema } = options

  return {
    id: `session-active-generations:${sessionId}`,
    schema,
    getKey: (gen) => gen.messageId,

    // Derived via livequery - detects incomplete messages
    query: (q) =>
      q
        .from({ row: streamCollection })
        .fn.select(({ rows }) => {
          const allRows = rows as StreamRowWithOffset[]
          const grouped = groupRowsByMessage(allRows)
          return detectActiveGenerations(grouped)
        })
        // Flatten the array of active generations
        .fn.flatMap((generations) => generations),
  }
}

/**
 * Check if any generation is currently active.
 *
 * @param collection - Active generations collection
 * @returns Whether any message is being generated
 */
export function hasActiveGeneration(
  collection: Collection<ActiveGenerationRow>
): boolean {
  return collection.size > 0
}

/**
 * Get the most recent active generation.
 *
 * @param collection - Active generations collection
 * @returns Most recent active generation or undefined
 */
export function getMostRecentActiveGeneration(
  collection: Collection<ActiveGenerationRow>
): ActiveGenerationRow | undefined {
  let mostRecent: ActiveGenerationRow | undefined
  let mostRecentTime: Date | undefined

  for (const gen of collection.values()) {
    if (!mostRecentTime || gen.startedAt > mostRecentTime) {
      mostRecent = gen
      mostRecentTime = gen.startedAt
    }
  }

  return mostRecent
}

/**
 * Get active generations for a specific actor.
 *
 * @param collection - Active generations collection
 * @param actorId - Actor identifier
 * @returns Array of active generations for the actor
 */
export function getActiveGenerationsForActor(
  collection: Collection<ActiveGenerationRow>,
  actorId: string
): ActiveGenerationRow[] {
  const result: ActiveGenerationRow[] = []
  for (const gen of collection.values()) {
    if (gen.actorId === actorId) {
      result.push(gen)
    }
  }
  return result
}

/**
 * Check if a specific message is being generated.
 *
 * @param collection - Active generations collection
 * @param messageId - Message identifier
 * @returns Whether the message is being generated
 */
export function isMessageGenerating(
  collection: Collection<ActiveGenerationRow>,
  messageId: string
): boolean {
  return collection.has(messageId)
}
