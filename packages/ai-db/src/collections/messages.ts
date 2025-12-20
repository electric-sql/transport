/**
 * Messages collection - core live query pipeline.
 *
 * Architecture:
 * - chunks → (subquery: groupBy + collect) → messages
 * - Derived collections use .fn.where() to filter by message parts
 *
 * The subquery inlines the chunk aggregation, eliminating the need for
 * a separate intermediate collection. Derived collections are lazy -
 * filtering overhead only incurred if the collection is accessed.
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
import type { ToolCallPart } from '@tanstack/ai'
import type { ChunkRow } from '../schema'
import type { MessageRow } from '../types'
import { materializeMessage } from '../materialize'

// ============================================================================
// Messages Collection (Root)
// ============================================================================

/**
 * Options for creating a messages collection.
 */
export interface MessagesCollectionOptions {
  /** Chunks collection from stream-db */
  chunksCollection: Collection<ChunkRow>
}

/**
 * Creates the messages collection with inline subquery for chunk aggregation.
 *
 * This is the root materialized collection in the live query pipeline.
 * All derived collections (toolCalls, pendingApprovals, etc.) derive from this.
 *
 * The subquery groups chunks by messageId and collects them, then the outer
 * query materializes each group into a MessageRow using TanStack AI's
 * StreamProcessor.
 *
 * @example
 * ```typescript
 * const messages = createMessagesCollection({
 *   chunksCollection: db.collections.chunks,
 * })
 *
 * // Access messages directly
 * for (const message of messages.values()) {
 *   console.log(message.id, message.role, message.parts)
 * }
 *
 * // Filter tool calls from message parts
 * const toolCalls = message.parts.filter(p => p.type === 'tool-call')
 * ```
 */
export function createMessagesCollection(
  options: MessagesCollectionOptions
): Collection<MessageRow> {
  const { chunksCollection } = options

  return createLiveQueryCollection({
    query: (q) => {
      // Subquery: group chunks by messageId and collect them
      const collected = q
        .from({ chunk: chunksCollection })
        .groupBy(({ chunk }) => chunk.messageId)
        .select(({ chunk }) => ({
          messageId: chunk.messageId,
          rows: collect(chunk),
          // Capture earliest timestamp for ordering (ISO 8601 strings sort lexicographically)
          startedAt: minStr(chunk.createdAt),
          // Count as discriminator to force change detection when rows are added
          rowCount: count(chunk),
        }))

      // Main query: materialize messages from collected chunks
      return q
        .from({ collected })
        .orderBy(({ collected }) => collected.startedAt, 'asc')
        .fn.select(({ collected }) => materializeMessage(collected.rows))
    },
    getKey: (row) => row.id,
  })
}

// ============================================================================
// Derived Collections
// ============================================================================

/**
 * Options for creating a derived collection from messages.
 */
export interface DerivedMessagesCollectionOptions {
  /** Messages collection to derive from */
  messagesCollection: Collection<MessageRow>
}

/**
 * Creates a collection of messages that contain tool calls.
 *
 * Filters messages where at least one part has type 'tool-call'.
 * The collection is lazy - filtering only runs when accessed.
 *
 * @example
 * ```typescript
 * const toolCalls = createToolCallsCollection({
 *   messagesCollection: messages,
 * })
 *
 * for (const message of toolCalls.values()) {
 *   for (const part of message.parts) {
 *     if (part.type === 'tool-call') {
 *       console.log(part.name, part.state, part.arguments)
 *     }
 *   }
 * }
 * ```
 */
export function createToolCallsCollection(
  options: DerivedMessagesCollectionOptions
): Collection<MessageRow> {
  const { messagesCollection } = options

  return createLiveQueryCollection({
    query: (q) =>
      q
        .from({ message: messagesCollection })
        .fn.where(({ message }) =>
          message.parts.some((p): p is ToolCallPart => p.type === 'tool-call')
        )
        .orderBy(({ message }) => message.createdAt, 'asc'),
    getKey: (row) => row.id,
  })
}

/**
 * Creates a collection of messages that have pending approval requests.
 *
 * Filters messages where at least one tool call part has:
 * - approval.needsApproval === true
 * - approval.approved === undefined (not yet responded)
 *
 * @example
 * ```typescript
 * const pending = createPendingApprovalsCollection({
 *   messagesCollection: messages,
 * })
 *
 * for (const message of pending.values()) {
 *   for (const part of message.parts) {
 *     if (part.type === 'tool-call' && part.approval?.needsApproval) {
 *       console.log(`Approval needed for ${part.name}: ${part.approval.id}`)
 *     }
 *   }
 * }
 * ```
 */
export function createPendingApprovalsCollection(
  options: DerivedMessagesCollectionOptions
): Collection<MessageRow> {
  const { messagesCollection } = options

  return createLiveQueryCollection({
    query: (q) =>
      q
        .from({ message: messagesCollection })
        .fn.where(({ message }) =>
          message.parts.some(
            (p): p is ToolCallPart =>
              p.type === 'tool-call' &&
              p.approval?.needsApproval === true &&
              p.approval.approved === undefined
          )
        )
        .orderBy(({ message }) => message.createdAt, 'asc'),
    getKey: (row) => row.id,
  })
}

/**
 * Creates a collection of messages that contain tool results.
 *
 * Filters messages where at least one part has type 'tool-result'.
 *
 * @example
 * ```typescript
 * const results = createToolResultsCollection({
 *   messagesCollection: messages,
 * })
 *
 * for (const message of results.values()) {
 *   for (const part of message.parts) {
 *     if (part.type === 'tool-result') {
 *       console.log(part.toolCallId, part.content)
 *     }
 *   }
 * }
 * ```
 */
export function createToolResultsCollection(
  options: DerivedMessagesCollectionOptions
): Collection<MessageRow> {
  const { messagesCollection } = options

  return createLiveQueryCollection({
    query: (q) =>
      q
        .from({ message: messagesCollection })
        .fn.where(({ message }) =>
          message.parts.some((p) => p.type === 'tool-result')
        )
        .orderBy(({ message }) => message.createdAt, 'asc'),
    getKey: (row) => row.id,
  })
}
