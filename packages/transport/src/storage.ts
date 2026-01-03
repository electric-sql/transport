import type { Offset } from '@durable-streams/client'
import type { APIResponse } from './schema'

// ============================================================================
// Types
// ============================================================================

export type ActiveGeneration = {
  data: APIResponse
  // Single Durable Streams offset for resumption
  streamOffset: Offset
}

type TimestampedActiveGeneration = ActiveGeneration & {
  timestamp: number
}

type TimestampedMessages<T> = {
  messages: T[]
  timestamp: number
}

export type StorageOptions = {
  // TTL in milliseconds. Default varies by storage type:
  // - Active generation: 1 hour
  // - Persisted messages: 7 days
  ttlMs?: number
}

// ============================================================================
// Constants
// ============================================================================

const ACTIVE_GENERATION_PREFIX = `@durable-streams/transport/active-generation`
const MESSAGES_PREFIX = `@durable-streams/transport/messages`

const DEFAULT_ACTIVE_GENERATION_TTL_MS = 60 * 60 * 1000 // 1 hour
const DEFAULT_MESSAGES_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// ============================================================================
// Key Builders
// ============================================================================

function buildActiveGenerationKey(sessionId: string): string {
  return `${ACTIVE_GENERATION_PREFIX}/${sessionId}`
}

function buildMessagesKey(sessionId: string): string {
  return `${MESSAGES_PREFIX}/${sessionId}`
}

// ============================================================================
// Active Generation Storage
// ============================================================================

function buildActiveGenerationPayload(
  data: APIResponse,
  streamOffset: Offset
): TimestampedActiveGeneration {
  return {
    data,
    streamOffset,
    timestamp: Date.now(),
  }
}

export function getActiveGeneration(
  sessionId: string,
  ttlMs: number = DEFAULT_ACTIVE_GENERATION_TTL_MS
): ActiveGeneration | null {
  if (typeof localStorage === `undefined`) {
    return null
  }
  const key = buildActiveGenerationKey(sessionId)
  const valueStr = localStorage.getItem(key)

  if (valueStr === null) {
    return null
  }

  let value: TimestampedActiveGeneration
  try {
    value = JSON.parse(valueStr)
  } catch (_err) {
    return null
  }

  const { data, streamOffset, timestamp } = value

  // Check if generation is stale
  if (Date.now() - timestamp > ttlMs) {
    localStorage.removeItem(key)
    return null
  }

  return {
    data,
    streamOffset,
  }
}

export function setActiveGeneration(
  sessionId: string,
  data: APIResponse,
  streamOffset: Offset
): void {
  if (typeof localStorage === `undefined`) {
    return
  }

  const key = buildActiveGenerationKey(sessionId)
  const payload = buildActiveGenerationPayload(data, streamOffset)

  localStorage.setItem(key, JSON.stringify(payload))
}

export function clearActiveGeneration(sessionId: string): void {
  if (typeof localStorage === `undefined`) {
    return
  }

  const key = buildActiveGenerationKey(sessionId)
  localStorage.removeItem(key)
}

// ============================================================================
// Message Persistence Storage
// ============================================================================

export function getPersistedMessages<T>(
  sessionId: string,
  ttlMs: number = DEFAULT_MESSAGES_TTL_MS
): T[] {
  if (typeof localStorage === `undefined`) {
    return []
  }
  const key = buildMessagesKey(sessionId)
  const valueStr = localStorage.getItem(key)

  if (valueStr === null) {
    return []
  }

  let value: TimestampedMessages<T>
  try {
    value = JSON.parse(valueStr)
  } catch (_err) {
    return []
  }

  const { messages, timestamp } = value

  // Check if messages are stale
  if (Date.now() - timestamp > ttlMs) {
    localStorage.removeItem(key)
    return []
  }

  return messages
}

export function setPersistedMessages<T>(
  sessionId: string,
  messages: T[]
): void {
  if (typeof localStorage === `undefined`) {
    return
  }

  const key = buildMessagesKey(sessionId)
  const payload: TimestampedMessages<T> = {
    messages,
    timestamp: Date.now(),
  }

  localStorage.setItem(key, JSON.stringify(payload))
}

export function clearPersistedMessages(sessionId: string): void {
  if (typeof localStorage === `undefined`) {
    return
  }

  const key = buildMessagesKey(sessionId)
  localStorage.removeItem(key)
}

// ============================================================================
// Session Cleanup
// ============================================================================

/**
 * Clear all persisted data for a session (both active generation and messages).
 */
export function clearSession(sessionId: string): void {
  clearActiveGeneration(sessionId)
  clearPersistedMessages(sessionId)
}
