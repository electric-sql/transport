import { z } from 'zod'

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
