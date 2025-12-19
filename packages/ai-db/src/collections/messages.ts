/**
 * Messages collection - two-stage derived pipeline.
 *
 * Stage 1: collectedMessages - groups chunk rows by messageId using collect()
 * Stage 2: messages - materializes MessageRow objects using fn.select()
 *
 * This follows the pattern: aggregate first → materialize second
 *
 * CRITICAL: Materialization happens INSIDE fn.select(). No imperative code
 * outside this pattern.
 */

import {
  createLiveQueryCollection,
  collect,
  count,
  minStr,
} from '@tanstack/db'
import type { Collection } from '@tanstack/db'
import type { ChunkRow } from '../schema'
import type { MessageRow } from '../types'
import { materializeMessage } from '../materialize'

// ============================================================================
// Stage 1: Collected Messages (intermediate)
// ============================================================================

/**
 * Intermediate type - collected rows grouped by messageId.
 * This is the output of Stage 1 and input to Stage 2.
 */
export interface CollectedMessageRows {
  messageId: string
  rows: ChunkRow[]
  /**
   * The earliest createdAt timestamp (ISO 8601 string) among collected rows.
   * Used for ordering messages chronologically.
   * ISO 8601 strings sort lexicographically correctly.
   */
  startedAt: string | null | undefined
  /**
   * Number of rows in this group.
   * Used as a discriminator to force change detection when new rows are added.
   * Without this, TanStack DB might not detect that the rows array has changed
   * since the messageId key and startedAt remain the same.
   */
  rowCount: number
}

/**
 * Options for creating a collected messages collection.
 */
export interface CollectedMessagesCollectionOptions {
  /** Session identifier */
  sessionId: string
  /** Chunks collection from stream-db */
  chunksCollection: Collection<ChunkRow>
}

/**
 * Creates the Stage 1 collection: groups chunk rows by messageId.
 *
 * This is an intermediate collection - consumers should use the
 * messages collection (Stage 2) which materializes the rows.
 */
export function createCollectedMessagesCollection(
  options: CollectedMessagesCollectionOptions
): Collection<CollectedMessageRows> {
  const { chunksCollection } = options

  const collection = createLiveQueryCollection({
    query: (q) =>
      q
        .from({ chunk: chunksCollection })
        .groupBy(({ chunk }) => chunk.messageId)
        .select(({ chunk }) => ({
          messageId: chunk.messageId,
          rows: collect(chunk),
          // Capture earliest timestamp for message ordering (ISO 8601 strings sort lexicographically)
          startedAt: minStr(chunk.createdAt),
          // Count rows as a discriminator to force change detection when new rows are added.
          // Without this, TanStack DB might not detect that the rows array has changed
          // since the messageId key and startedAt remain the same.
          rowCount: count(chunk),
        })),
    getKey: (row) => row.messageId,
  })

  return collection
}

// ============================================================================
// Stage 2: Materialized Messages
// ============================================================================

/**
 * Options for creating a messages collection.
 */
export interface MessagesCollectionOptions {
  /** Session identifier */
  sessionId: string
  /** Collected messages collection (Stage 1) */
  collectedMessagesCollection: Collection<CollectedMessageRows>
}

/**
 * Creates the Stage 2 collection: materializes MessageRow from collected rows.
 *
 * This is the collection that consumers should use - it contains fully
 * materialized MessageRow objects, not intermediate collected rows.
 *
 * @example
 * ```typescript
 * // First create the intermediate collection
 * const collectedMessages = createCollectedMessagesCollection({
 *   sessionId: 'my-session',
 *   chunksCollection: db.collections.chunks,
 * })
 *
 * // Then create the materialized messages collection
 * const messages = createMessagesCollection({
 *   sessionId: 'my-session',
 *   collectedMessagesCollection: collectedMessages,
 * })
 *
 * // Access messages directly - no helper functions needed
 * for (const message of messages.values()) {
 *   console.log(message.id, message.role, message.parts)
 * }
 * ```
 */
export function createMessagesCollection(
  options: MessagesCollectionOptions
): Collection<MessageRow> {
  const { collectedMessagesCollection } = options

  // Pass query function to createLiveQueryCollection to let it infer types.
  // Use config object form to provide explicit getKey - this is required for
  // optimistic mutations (insert/update/delete) on derived collections.
  const collection = createLiveQueryCollection({
    query: (q) =>
      q
        .from({ collected: collectedMessagesCollection })
        .orderBy(({ collected }) => collected.startedAt, 'asc')
        .fn.select(({ collected }) => materializeMessage(collected.rows)),
    getKey: (row) => row.id,
  })

  return collection
}

// ============================================================================
// Combined Factory (convenience)
// ============================================================================

/**
 * Options for creating both stages of the messages pipeline.
 */
export interface MessagesPipelineOptions {
  /** Session identifier */
  sessionId: string
  /** Chunks collection from stream-db */
  chunksCollection: Collection<ChunkRow>
}

/**
 * Result of creating the messages pipeline.
 */
export interface MessagesPipelineResult {
  /** Stage 1: Collected messages (intermediate - usually not needed directly) */
  collectedMessages: Collection<CollectedMessageRows>
  /** Stage 2: Materialized messages (use this one) */
  messages: Collection<MessageRow>
}

/**
 * Creates the complete messages pipeline (both stages).
 *
 * This is a convenience function that creates both the intermediate
 * collected messages collection and the final materialized messages collection.
 *
 * @example
 * ```typescript
 * const { messages } = createMessagesPipeline({
 *   sessionId: 'my-session',
 *   chunksCollection: db.collections.chunks,
 * })
 *
 * // Access messages directly
 * const allMessages = messages.toArray()
 * const singleMessage = messages.get('message-id')
 * ```
 */
export function createMessagesPipeline(
  options: MessagesPipelineOptions
): MessagesPipelineResult {
  const { sessionId, chunksCollection } = options

  // Stage 1: Create collected messages collection
  const collectedMessages = createCollectedMessagesCollection({
    sessionId,
    chunksCollection,
  })

  // Stage 2: Create materialized messages collection
  const messages = createMessagesCollection({
    sessionId,
    collectedMessagesCollection: collectedMessages,
  })

  return { collectedMessages, messages }
}

