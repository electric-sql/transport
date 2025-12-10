/**
 * Messages collection - two-stage derived pipeline.
 *
 * Stage 1: collectedMessages - groups stream rows by messageId using collect()
 * Stage 2: messages - materializes MessageRow objects using fn.select()
 *
 * This follows the pattern: aggregate first → materialize second
 */

import {
  createLiveQueryCollection,
  collect,
} from '@tanstack/db'
import type { Collection } from '@tanstack/db'
import type { StreamRowWithOffset, MessageRow } from '../types'
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
  rows: StreamRowWithOffset[]
}

/**
 * Options for creating a collected messages collection.
 */
export interface CollectedMessagesCollectionOptions {
  /** Session identifier */
  sessionId: string
  /** Stream collection to derive from */
  streamCollection: Collection<StreamRowWithOffset>
}

/**
 * Creates the Stage 1 collection: groups stream rows by messageId.
 *
 * This is an intermediate collection - consumers should use the
 * messages collection (Stage 2) which materializes the rows.
 */
export function createCollectedMessagesCollection(
  options: CollectedMessagesCollectionOptions
) {
  const { streamCollection } = options

  // Pass query function directly to createLiveQueryCollection to let it infer types
  return createLiveQueryCollection((q) =>
    q
      .from({ row: streamCollection })
      .groupBy(({ row }) => row.messageId)
      .select(({ row }) => ({
        messageId: row.messageId,
        rows: collect(row),
      }))
  )
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
 *   streamCollection,
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
) {
  const { collectedMessagesCollection } = options

  // Pass query function directly to createLiveQueryCollection to let it infer types
  return createLiveQueryCollection((q) =>
    q
      .from({ collected: collectedMessagesCollection })
      .fn.select(({ collected }) => materializeMessage(collected.rows))
  )
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
  /** Stream collection to derive from */
  streamCollection: Collection<StreamRowWithOffset>
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
 *   streamCollection,
 * })
 *
 * // Access messages directly
 * const allMessages = messages.toArray()
 * const singleMessage = messages.get('message-id')
 * ```
 */
export function createMessagesPipeline(
  options: MessagesPipelineOptions
) {
  const { sessionId, streamCollection } = options

  // Stage 1: Create collected messages collection
  const collectedMessages = createCollectedMessagesCollection({
    sessionId,
    streamCollection,
  })

  // Stage 2: Create materialized messages collection
  const messages = createMessagesCollection({
    sessionId,
    collectedMessagesCollection: collectedMessages,
  })

  return { collectedMessages, messages }
}

// ============================================================================
// Utility: Wait for message sync
// ============================================================================

/**
 * Wait for a key to appear in a collection's synced data.
 *
 * @param collection - Collection to wait on
 * @param key - Key to wait for
 * @param timeout - Timeout in milliseconds
 * @returns Promise that resolves when key appears
 */
export function waitForKey<T extends object>(
  collection: Collection<T, string | number>,
  key: string | number,
  timeout = 30000
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if already present (race condition guard)
    if (collection.has(key)) {
      resolve()
      return
    }

    const timer = setTimeout(() => {
      subscription.unsubscribe()
      reject(new Error(`Timeout waiting for key ${key}`))
    }, timeout)

    const subscription = collection.subscribeChanges((changes) => {
      const found = changes.some(
        (c) => c.type === 'insert' && collection.getKeyFromItem(c.value) === key
      )
      if (found || collection.has(key)) {
        clearTimeout(timer)
        subscription.unsubscribe()
        resolve()
      }
    })
  })
}
