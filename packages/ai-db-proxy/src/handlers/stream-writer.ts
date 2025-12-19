/**
 * Stream writer handler - utilities for writing to durable streams.
 */

import type { DurableStream } from '@durable-streams/client'
import type { AIDBSessionProtocol } from '../protocol'
import type { StreamChunk } from '../types'

/** Message role type (aligned with protocol) */
type MessageRole = 'user' | 'assistant' | 'system'

/**
 * StreamWriter provides convenient methods for writing different
 * types of chunks to a session stream.
 */
export class StreamWriter {
  constructor(
    private readonly protocol: AIDBSessionProtocol,
    private readonly stream: DurableStream,
    private readonly sessionId: string
  ) {}

  /**
   * Write a user message.
   *
   * @param txid - Optional transaction ID for client sync confirmation
   */
  async writeUserMessage(
    messageId: string,
    actorId: string,
    content: string,
    txid?: string
  ): Promise<void> {
    await this.protocol.writeUserMessage(
      this.stream,
      this.sessionId,
      messageId,
      actorId,
      content,
      txid
    )
  }

  /**
   * Write a generic chunk.
   *
   * @param txid - Optional transaction ID for client sync confirmation
   */
  async writeChunk(
    messageId: string,
    actorId: string,
    role: MessageRole,
    chunk: StreamChunk,
    txid?: string
  ): Promise<void> {
    await this.protocol.writeChunk(
      this.stream,
      this.sessionId,
      messageId,
      actorId,
      role,
      chunk,
      txid
    )
  }

  /**
   * Write a tool result.
   *
   * @param txid - Optional transaction ID for client sync confirmation
   */
  async writeToolResult(
    messageId: string,
    actorId: string,
    toolCallId: string,
    output: unknown,
    error: string | null,
    txid?: string
  ): Promise<void> {
    await this.protocol.writeToolResult(
      this.stream,
      this.sessionId,
      messageId,
      actorId,
      toolCallId,
      output,
      error,
      txid
    )
  }

  /**
   * Write an approval response.
   *
   * @param txid - Optional transaction ID for client sync confirmation
   */
  async writeApprovalResponse(
    actorId: string,
    approvalId: string,
    approved: boolean,
    txid?: string
  ): Promise<void> {
    await this.protocol.writeApprovalResponse(
      this.stream,
      this.sessionId,
      actorId,
      approvalId,
      approved,
      txid
    )
  }
}

/**
 * Create a stream writer for a session.
 */
export function createStreamWriter(
  protocol: AIDBSessionProtocol,
  stream: DurableStream,
  sessionId: string
): StreamWriter {
  return new StreamWriter(protocol, stream, sessionId)
}
