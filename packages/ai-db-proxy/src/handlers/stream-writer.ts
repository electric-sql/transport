/**
 * Stream writer handler - utilities for writing to durable streams.
 */

import type { Stream } from '@durable-streams/wrapper-sdk'
import type { AIDBSessionProtocol } from '../protocol'
import type { StreamChunk, ActorType } from '../types'

/**
 * StreamWriter provides convenient methods for writing different
 * types of chunks to a session stream.
 */
export class StreamWriter {
  constructor(
    private readonly protocol: AIDBSessionProtocol,
    private readonly stream: Stream,
    private readonly sessionId: string
  ) {}

  /**
   * Write a user message.
   */
  async writeUserMessage(
    messageId: string,
    actorId: string,
    content: string
  ): Promise<void> {
    await this.protocol.writeUserMessage(
      this.stream,
      this.sessionId,
      messageId,
      actorId,
      content
    )
  }

  /**
   * Write a generic chunk.
   */
  async writeChunk(
    messageId: string,
    actorId: string,
    actorType: ActorType,
    chunk: StreamChunk
  ): Promise<void> {
    await this.protocol.writeChunk(
      this.stream,
      this.sessionId,
      messageId,
      actorId,
      actorType,
      chunk
    )
  }

  /**
   * Write a tool result.
   */
  async writeToolResult(
    actorId: string,
    toolCallId: string,
    output: unknown,
    error: string | null
  ): Promise<void> {
    await this.protocol.writeToolResult(
      this.stream,
      this.sessionId,
      actorId,
      toolCallId,
      output,
      error
    )
  }

  /**
   * Write an approval response.
   */
  async writeApprovalResponse(
    actorId: string,
    approvalId: string,
    approved: boolean
  ): Promise<void> {
    await this.protocol.writeApprovalResponse(
      this.stream,
      this.sessionId,
      actorId,
      approvalId,
      approved
    )
  }
}

/**
 * Create a stream writer for a session.
 */
export function createStreamWriter(
  protocol: AIDBSessionProtocol,
  stream: Stream,
  sessionId: string
): StreamWriter {
  return new StreamWriter(protocol, stream, sessionId)
}
