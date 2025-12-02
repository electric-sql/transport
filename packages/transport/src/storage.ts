import type { Offset } from '@electric-sql/client'
import type { APIResponse } from './schema'

export type ActiveGeneration = {
  data: APIResponse
  handle: string
  offset: Offset
}
type TimestampedActiveGeneration = ActiveGeneration & {
  timestamp: number
}

const PREFIX = `@electric-sql/transport/active-generation/`
const ONE_HOUR_MS = 60 * 60 * 1000

function buildKey(sessionId: string): string {
  return `${PREFIX}-${sessionId}`
}

function buildPayload(
  data: APIResponse,
  handle: string,
  offset: Offset
): TimestampedActiveGeneration {
  const timestamp = Date.now()

  return { data, handle, offset, timestamp }
}

export function getActiveGeneration(
  sessionId: string
): ActiveGeneration | null {
  if (typeof localStorage === `undefined`) {
    return null
  }

  const key = buildKey(sessionId)
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

  const { data, handle, offset, timestamp } = value

  // Check if generation is stale (older than 1 hour)
  if (Date.now() - timestamp > ONE_HOUR_MS) {
    localStorage.removeItem(key)

    return null
  }

  return { data, handle, offset }
}

export function setActiveGeneration(
  sessionId: string,
  data: APIResponse,
  handle: string,
  offset: Offset
): void {
  if (typeof localStorage === `undefined`) {
    return
  }

  const key = buildKey(sessionId)
  const payload = buildPayload(data, handle, offset)

  localStorage.setItem(key, JSON.stringify(payload))
}

export function clearActiveGeneration(sessionId: string): void {
  if (typeof localStorage === `undefined`) {
    return
  }

  const key = buildKey(sessionId)

  localStorage.removeItem(key)
}
