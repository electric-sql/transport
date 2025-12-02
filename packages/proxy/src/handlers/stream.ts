import { electricUrl } from '../config'
import type { StreamRequestData } from '../schema'

export async function handleStreamRequest({
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

  url.searchParams.set(`table`, `chunks`)
  url.searchParams.set(`where`, whereClause)

  return await fetch(url)
}
