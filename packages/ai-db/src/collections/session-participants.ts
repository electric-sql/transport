/**
 * Session participants collection - two-stage derived pipeline.
 *
 * Extracts unique participants from stream rows by grouping by actorId.
 *
 * This follows the pattern: aggregate first → materialize second
 */

import { createLiveQueryCollection, collect } from '@tanstack/db'
import type { Collection } from '@tanstack/db'
import type { StreamRowWithOffset, SessionParticipant } from '../types'

// ============================================================================
// Session Participants Collection
// ============================================================================

/**
 * Intermediate type - collected rows grouped by actorId.
 */
interface CollectedActorRows {
  actorId: string
  rows: StreamRowWithOffset[]
}

/**
 * Options for creating a session participants collection.
 */
export interface SessionParticipantsCollectionOptions {
  /** Session identifier */
  sessionId: string
  /** Stream collection to derive from */
  streamCollection: Collection<StreamRowWithOffset>
}

/**
 * Convert collected rows for an actor into a SessionParticipant.
 */
function rowsToParticipant(
  actorId: string,
  rows: StreamRowWithOffset[]
): SessionParticipant {
  // Find the most recent activity
  let lastSeenAt = new Date(0)
  let actorType: 'user' | 'agent' = 'user'

  for (const row of rows) {
    const rowTime = new Date(row.createdAt)
    if (rowTime > lastSeenAt) {
      lastSeenAt = rowTime
      actorType = row.actorType
    }
  }

  return {
    actorId,
    actorType,
    lastSeenAt,
  }
}

/**
 * Creates the session participants collection.
 *
 * Uses a two-stage pipeline:
 * 1. Group stream rows by actorId and collect
 * 2. Use fn.select to create SessionParticipant from collected rows
 *
 * @example
 * ```typescript
 * const participants = createSessionParticipantsCollection({
 *   sessionId: 'my-session',
 *   streamCollection,
 * })
 *
 * // Access participants directly
 * for (const participant of participants.values()) {
 *   console.log(participant.actorId, participant.actorType, participant.lastSeenAt)
 * }
 * ```
 */
export function createSessionParticipantsCollection(
  options: SessionParticipantsCollectionOptions
): Collection<SessionParticipant> {
  const { sessionId, streamCollection } = options

  // Stage 1: Create intermediate collection grouped by actorId
  // startSync: true ensures the collection starts syncing immediately.
  const collectedByActor = createLiveQueryCollection({
    query: (q) =>
      q
        .from({ row: streamCollection })
        .groupBy(({ row }) => row.actorId)
        .select(({ row }) => ({
          actorId: row.actorId,
          rows: collect(row),
        })),
    startSync: true,
  })

  // Stage 2: Transform to SessionParticipant
  // startSync: true ensures the collection starts syncing immediately.
  return createLiveQueryCollection({
    query: (q) =>
      q
        .from({ collected: collectedByActor })
        .fn.select(({ collected }) =>
          rowsToParticipant(collected.actorId, collected.rows)
        ),
    startSync: true,
  })
}
