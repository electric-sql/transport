/**
 * Session metadata collection - partially local, partially derived.
 *
 * Tracks connection state, sync progress, and participant information.
 */

import type {
  Collection,
  CollectionConfig,
  StandardSchemaV1,
} from '@tanstack/db'
import type {
  StreamRowWithOffset,
  SessionMetaRow,
  SessionParticipant,
  ConnectionStatus,
  ActorType,
} from '../types'

/**
 * Options for creating a session meta collection.
 */
export interface SessionMetaCollectionOptions {
  /** Session identifier */
  sessionId: string
  /** Stream collection to derive participant info from */
  streamCollection: Collection<StreamRowWithOffset>
  /** Optional schema for validation */
  schema?: StandardSchemaV1<SessionMetaRow>
}

/**
 * Creates collection config for the session metadata collection.
 *
 * This collection combines:
 * - Local state: connectionStatus, lastSyncedOffset, error
 * - Derived state: participants (from stream actors)
 *
 * The collection is a single-row collection keyed by sessionId.
 *
 * @example
 * ```typescript
 * import { createSessionMetaCollectionOptions } from '@electric-sql/ai-db'
 * import { createCollection } from '@tanstack/db'
 *
 * const sessionMetaCollection = createCollection(
 *   createSessionMetaCollectionOptions({
 *     sessionId: 'my-session',
 *     streamCollection,
 *   })
 * )
 * ```
 */
export function createSessionMetaCollectionOptions(
  options: SessionMetaCollectionOptions
): CollectionConfig<SessionMetaRow> {
  const { sessionId, schema } = options

  return {
    id: `session-meta:${sessionId}`,
    schema,
    getKey: (meta) => meta.sessionId,
  }
}

/**
 * Create initial session metadata.
 *
 * @param sessionId - Session identifier
 * @returns Initial session metadata row
 */
export function createInitialSessionMeta(sessionId: string): SessionMetaRow {
  return {
    sessionId,
    connectionStatus: 'disconnected',
    lastSyncedOffset: null,
    lastSyncedAt: null,
    error: null,
    participants: [],
  }
}

/**
 * Extract unique participants from stream rows.
 *
 * @param rows - Stream rows to extract from
 * @returns Array of unique participants
 */
export function extractParticipants(
  rows: StreamRowWithOffset[]
): SessionParticipant[] {
  const participantMap = new Map<string, SessionParticipant>()

  for (const row of rows) {
    const existing = participantMap.get(row.actorId)
    const rowTime = new Date(row.createdAt)

    if (existing) {
      // Update last seen time if this row is newer
      if (rowTime > existing.lastSeenAt) {
        existing.lastSeenAt = rowTime
      }
    } else {
      // New participant
      participantMap.set(row.actorId, {
        actorId: row.actorId,
        actorType: row.actorType,
        lastSeenAt: rowTime,
      })
    }
  }

  return Array.from(participantMap.values())
}

/**
 * Update session metadata with new connection status.
 *
 * @param meta - Current metadata
 * @param status - New connection status
 * @param error - Optional error information
 * @returns Updated metadata
 */
export function updateConnectionStatus(
  meta: SessionMetaRow,
  status: ConnectionStatus,
  error?: { message: string; code?: string } | null
): SessionMetaRow {
  return {
    ...meta,
    connectionStatus: status,
    error: error ?? (status === 'connected' ? null : meta.error),
  }
}

/**
 * Update session metadata with sync progress.
 *
 * @param meta - Current metadata
 * @param offset - Last synced offset
 * @returns Updated metadata
 */
export function updateSyncProgress(
  meta: SessionMetaRow,
  offset: string
): SessionMetaRow {
  return {
    ...meta,
    lastSyncedOffset: offset,
    lastSyncedAt: new Date(),
    connectionStatus: 'connected',
    error: null,
  }
}

/**
 * Update session metadata with participants.
 *
 * @param meta - Current metadata
 * @param participants - New participant list
 * @returns Updated metadata
 */
export function updateParticipants(
  meta: SessionMetaRow,
  participants: SessionParticipant[]
): SessionMetaRow {
  return {
    ...meta,
    participants,
  }
}

/**
 * Add or update a participant.
 *
 * @param meta - Current metadata
 * @param actorId - Actor identifier
 * @param actorType - Actor type
 * @param name - Optional display name
 * @returns Updated metadata
 */
export function upsertParticipant(
  meta: SessionMetaRow,
  actorId: string,
  actorType: ActorType,
  name?: string
): SessionMetaRow {
  const existing = meta.participants.find((p) => p.actorId === actorId)

  if (existing) {
    // Update existing participant
    return {
      ...meta,
      participants: meta.participants.map((p) =>
        p.actorId === actorId
          ? { ...p, lastSeenAt: new Date(), name: name ?? p.name }
          : p
      ),
    }
  }

  // Add new participant
  return {
    ...meta,
    participants: [
      ...meta.participants,
      {
        actorId,
        actorType,
        name,
        lastSeenAt: new Date(),
      },
    ],
  }
}
