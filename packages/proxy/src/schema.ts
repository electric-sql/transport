import { z } from 'zod'
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

export const apiRequestSchema = z.object({
  sessionId: z.string().uuid(),
  requestId: z.string().uuid(),
  url: z.string().url(),
  method: z
    .enum([`DELETE`, `GET`, `HEAD`, `PATCH`, `POST`, `PUT`])
    .default(`POST`),
  headers: z.record(z.string()).optional(),
  body: z.any().optional(),
})

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

export type APIRequestData = z.infer<typeof apiRequestSchema>
export type StreamRequestData = z.infer<typeof streamRequestSchema>
