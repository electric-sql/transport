/**
 * Root stream collection for syncing from Durable Streams.
 *
 * This collection is read-only and serves as the source of truth
 * for all durably persisted chat data.
 */

import { durableSessionStreamOptions } from '../collection'
import type { CollectionConfig } from '@tanstack/db'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { StreamRowWithOffset } from '../types'

/**
 * Options for creating a stream collection.
 */
export interface StreamCollectionOptions {
  /** Session identifier */
  sessionId: string
  /** Base URL for the proxy */
  baseUrl: string
  /** Initial offset to resume from */
  initialOffset?: string
  /** Additional headers for stream requests */
  headers?: Record<string, string>
  /** Optional schema for validation */
  schema?: StandardSchemaV1<StreamRowWithOffset>
  /**
   * AbortSignal to cancel the stream sync.
   * When aborted, the sync will stop and cleanup will be called.
   */
  signal?: AbortSignal
}

/**
 * Creates collection config for the root stream collection.
 *
 * This is a thin wrapper around durableSessionStreamOptions that
 * explicitly documents the read-only nature of this collection.
 *
 * @example
 * ```typescript
 * import { createStreamCollectionOptions } from '@electric-sql/ai-db'
 * import { createCollection } from '@tanstack/db'
 *
 * const streamCollection = createCollection(
 *   createStreamCollectionOptions({
 *     sessionId: 'my-session',
 *     baseUrl: 'http://localhost:4000',
 *   })
 * )
 * ```
 */
export function createStreamCollectionOptions(
  options: StreamCollectionOptions
): CollectionConfig<StreamRowWithOffset> {
  return durableSessionStreamOptions({
    sessionId: options.sessionId,
    baseUrl: options.baseUrl,
    initialOffset: options.initialOffset,
    headers: options.headers,
    schema: options.schema,
    signal: options.signal,
  }) as CollectionConfig<StreamRowWithOffset>
}
