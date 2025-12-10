/**
 * Session stream collection configuration.
 *
 * Creates collection options for syncing a session's stream from Durable Streams.
 * Built on top of the generic @tanstack/durable-stream-db-collection.
 */

import { durableStreamCollectionOptions } from '@tanstack/durable-stream-db-collection'
import type { CollectionConfig } from '@tanstack/db'
import type {
  StreamRow,
  StreamRowWithOffset,
  DurableSessionStreamConfig,
} from './types'

/**
 * Creates collection options for syncing a session's stream.
 *
 * This function wraps the generic @tanstack/durable-stream-db-collection
 * with session-specific configuration:
 * - Session-aware URL pattern: `{baseUrl}/v1/stream/sessions/{sessionId}`
 * - Primary key: `${messageId}:${seq}`
 * - Deduplication key: `${messageId}:${seq}` (handles batch-level offset replays)
 * - Storage key prefix: `ai-db:session:{sessionId}`
 *
 * @example
 * ```typescript
 * import { durableSessionStreamOptions } from '@electric-sql/ai-db'
 * import { createCollection } from '@tanstack/db'
 *
 * const streamCollection = createCollection(
 *   durableSessionStreamOptions({
 *     sessionId: 'my-session',
 *     baseUrl: 'http://localhost:4000',
 *   })
 * )
 * ```
 */
export function durableSessionStreamOptions(config: DurableSessionStreamConfig) {
  const { sessionId, baseUrl, initialOffset, headers, schema } = config

  return durableStreamCollectionOptions<StreamRow>({
    // Stream URL for this session
    url: `${baseUrl}/v1/stream/sessions/${sessionId}`,

    // Primary key for collection lookups
    // Uses messageId:seq since seq is monotonically increasing per message
    getKey: (row) => `${row.messageId}:${row.seq}`,

    // Deduplication key for batch-offset replay handling
    // Same as primary key - uniquely identifies each chunk within a message
    getDeduplicationKey: (row) => `${row.messageId}:${row.seq}`,

    // Collection identifier
    id: `session-stream:${sessionId}`,

    // Optional schema for validation
    schema: schema as never,

    // Initial offset for resumption
    initialOffset,

    // Additional headers for stream requests
    headers,

    // Persist offsets with session-specific key
    storageKey: `ai-db:session:${sessionId}`,
  })
}

/**
 * Get the deduplication key for a stream row.
 *
 * @param row - Stream row to get key for
 * @returns Deduplication key string
 */
export function getDeduplicationKey(row: StreamRow): string {
  return `${row.messageId}:${row.seq}`
}

/**
 * Get the primary key for a stream row.
 *
 * @param row - Stream row to get key for
 * @returns Primary key string
 */
export function getStreamRowKey(row: StreamRow): string {
  return `${row.messageId}:${row.seq}`
}
