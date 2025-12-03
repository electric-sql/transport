import { z } from 'zod'
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

export const apiRequestParamsSchema = z.object({
  sessionId: z.string().uuid(),
  requestId: z.string().uuid(),
})

export const apiRequestHeadersSchema = z.object({
  'x-proxy-url': z.string().url(),
  'x-proxy-method': z
    .enum([`DELETE`, `GET`, `HEAD`, `PATCH`, `POST`, `PUT`])
    .default(`POST`),
})

export type APIRequestParams = z.infer<typeof apiRequestParamsSchema>
export type APIRequestHeaders = z.infer<typeof apiRequestHeadersSchema>

export const streamRequestSchema = z.object({
  sessionId: z.string().uuid(),
  requestId: z.string().uuid().optional(),
  ...Object.fromEntries(
    ELECTRIC_PROTOCOL_QUERY_PARAMS.map((param) => [
      param,
      z.string().optional(),
    ])
  ),
})

export type StreamRequestData = z.infer<typeof streamRequestSchema>
