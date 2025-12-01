import {
  ELECTRIC_PROTOCOL_QUERY_PARAMS,
  LIVE_SSE_QUERY_PARAM
} from '@electric-sql/client'

import { electricUrl } from '../config'
import type { ShapeRequestData } from '../schema'

const validParams = ELECTRIC_PROTOCOL_QUERY_PARAMS.concat([LIVE_SSE_QUERY_PARAM])

export function handleShapeRequest({ sessionId, requestId }: ShapeRequestData): Response {
  let whereClause = `session='${sessionId}'`
  if (requestId) {
    whereClause += ` AND request='${requestId}'`
  }

  const url = new URL(electricUrl)
  url.searchParams.forEach((value, key) => {
    if (validParams.includes(key)) {
      electricUrl.searchParams.set(key, value)
    }
  })
  url.searchParams.set('table', 'chunks')
  url.searchParams.set('where', whereClause)

  return await fetch(url)
}
