import { z } from 'zod'

export const responseSchema = z.object({
  sessionId: z.string().uuid(),
  requestId: z.string().uuid(),
  streamUrl: z.string().url(),
  controlUrl: z.string().url(),
  contentType: z.string().optional(),
})

export type APIResponse = z.infer<typeof responseSchema>
