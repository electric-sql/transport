import { z } from 'zod'

export const responseSchema = z.object({
  sessionId: z.string().uuid(),
  requestId: z.string().uuid(),
  streamUrl: z.string().url(),
  contentType: z.string().optional(),
})

export type APIResponse = z.infer<typeof responseSchema>

// Stream event types (transport-level framing, not protocol parsing)
export const dataEventSchema = z.object({
  type: z.literal(`data`),
  payload: z.string(),
})

export const doneEventSchema = z.object({
  type: z.literal(`done`),
  finishReason: z.string(),
})

export const errorEventSchema = z.object({
  type: z.literal(`error`),
  message: z.string(),
})

export const streamEventSchema = z.discriminatedUnion(`type`, [
  dataEventSchema,
  doneEventSchema,
  errorEventSchema,
])

export type DataEvent = z.infer<typeof dataEventSchema>
export type DoneEvent = z.infer<typeof doneEventSchema>
export type ErrorEvent = z.infer<typeof errorEventSchema>
export type StreamEvent = z.infer<typeof streamEventSchema>
