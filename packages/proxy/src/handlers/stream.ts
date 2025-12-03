import { electricUrl } from '../config'
import type { StreamRequestData } from '../schema'

/**
 * Handle requests for the data stream.
 * This stream contains pure binary data chunks without control signals.
 */
export async function handleDataStreamRequest({
  sessionId,
  requestId,
  ...params
}: StreamRequestData): Promise<Response> {
  let whereClause = `session='${sessionId}'`
  if (requestId) {
    whereClause += ` AND request='${requestId}'`
  }

  const url = new URL(electricUrl)

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      url.searchParams.set(key, value)
    }
  })

  url.searchParams.set(`table`, `data_chunks`)
  url.searchParams.set(`where`, whereClause)

  return await fetch(url)
}

/**
 * Handle requests for the control stream.
 * This stream contains lifecycle events (done, error, heartbeat).
 */
export async function handleControlStreamRequest({
  sessionId,
  requestId,
  ...params
}: StreamRequestData): Promise<Response> {
  let whereClause = `session='${sessionId}'`
  if (requestId) {
    whereClause += ` AND request='${requestId}'`
  }

  const url = new URL(electricUrl)

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      url.searchParams.set(key, value)
    }
  })

  url.searchParams.set(`table`, `control_messages`)
  url.searchParams.set(`where`, whereClause)

  return await fetch(url)
}
