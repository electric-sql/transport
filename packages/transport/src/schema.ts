import { z } from 'zod'

// There's currently some duplication of schema definitions
// between the proxy and transport packages.

export const apiRequestSchema = z.object({
  sessionId: z.string().uuid(),
  requestId: z.string().uuid(),
  url: z.string().url(),
  method: z
    .enum([`DELETE`, `GET`, `HEAD`, `PATCH`, `POST`, `PUT`])
    .default(`POST`),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.any().optional(),
})

export const responseSchema = z.object({
  sessionId: z.string().uuid(),
  requestId: z.string().uuid(),
  streamUrl: z.string().url(),
  errorUrl: z.string().optional(),
})

export type APIRequest = z.infer<typeof apiRequestSchema>
export type APIResponse = z.infer<typeof responseSchema>
