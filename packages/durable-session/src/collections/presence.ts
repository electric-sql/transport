/**
 * Aggregated presence collection - derived from raw per-device presence.
 *
 * The raw presence from stream-db tracks each (actorId, deviceId) pair.
 * This collection aggregates devices per actor, filtering for online status,
 * to provide a simple "who's online" view.
 */

import { createLiveQueryCollection, collect, count, eq } from '@tanstack/db'
import type { Collection } from '@tanstack/db'
import type { RawPresenceRow, PresenceRow } from '../schema'

// ============================================================================
// Aggregated Presence Collection
// ============================================================================

/**
 * Options for creating an aggregated presence collection.
 */
export interface PresenceCollectionOptions {
  /** Session identifier */
  sessionId: string
  /** Raw presence collection from stream-db (per-device records) */
  rawPresenceCollection: Collection<RawPresenceRow>
}

/**
 * Creates the aggregated presence collection.
 *
 * Uses a live query pipeline to:
 * 1. Filter raw presence for status='online'
 * 2. Group by actorId, actorType, name
 * 3. Collect deviceIds and count
 *
 * The result is one row per online actor, with their device count.
 *
 * @example
 * ```typescript
 * const presence = createPresenceCollection({
 *   sessionId: 'my-session',
 *   rawPresenceCollection: db.collections.presence,
 * })
 *
 * // Each row is one online actor
 * for (const actor of presence.values()) {
 *   console.log(actor.actorId, actor.name, actor.deviceCount)
 * }
 * ```
 */
export function createPresenceCollection(
  options: PresenceCollectionOptions
): Collection<PresenceRow> {
  const { rawPresenceCollection } = options

  // Single-stage pipeline: filter for online, group by actor, collect devices
  // startSync: true ensures the collection starts syncing immediately.
  // Note: All non-aggregate fields in select must appear in groupBy
  return createLiveQueryCollection({
    query: (q) =>
      q
        .from({ presence: rawPresenceCollection })
        // Filter for online devices only
        .where(({ presence }) => eq(presence.status, 'online'))
        // Group by actor fields - all non-aggregate select fields must be here
        .groupBy(({ presence }) => [presence.actorId, presence.actorType, presence.name])
        // Select aggregated fields
        .select(({ presence }) => ({
          actorId: presence.actorId,
          actorType: presence.actorType,
          name: presence.name,
          deviceIds: collect(presence.deviceId),
          deviceCount: count(presence.deviceId),
        })),
    startSync: true,
  })
}
