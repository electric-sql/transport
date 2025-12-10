/**
 * Approvals collection - two-stage derived pipeline.
 *
 * Tracks approval requests and responses for tool calls that require user authorization.
 * Derived from the collectedMessages intermediate collection.
 *
 * This follows the pattern: aggregate first → materialize second
 */

import { createLiveQueryCollection } from '@tanstack/db'
import type { Collection } from '@tanstack/db'
import type { ApprovalRow } from '../types'
import { extractApprovals } from '../materialize'
import type { CollectedMessageRows } from './messages'

// ============================================================================
// Approvals Collection
// ============================================================================

/**
 * Options for creating an approvals collection.
 */
export interface ApprovalsCollectionOptions {
  /** Session identifier */
  sessionId: string
  /** Collected messages collection (intermediate from messages pipeline) */
  collectedMessagesCollection: Collection<CollectedMessageRows>
}

/**
 * Creates the approvals collection from collected messages.
 *
 * Uses fn.select to extract approvals from each message's collected rows,
 * then flattens them into individual ApprovalRow entries.
 *
 * Approval lifecycle:
 * - pending: Approval requested, waiting for user response
 * - approved: User approved the tool call
 * - denied: User denied the tool call
 *
 * @example
 * ```typescript
 * const approvals = createApprovalsCollection({
 *   sessionId: 'my-session',
 *   collectedMessagesCollection,
 * })
 *
 * // Access approvals directly
 * for (const approval of approvals.values()) {
 *   console.log(approval.id, approval.status, approval.toolCallId)
 * }
 *
 * // Or filter for pending approvals
 * const pending = [...approvals.values()].filter(a => a.status === 'pending')
 * ```
 */
export function createApprovalsCollection(
  options: ApprovalsCollectionOptions
): Collection<ApprovalRow> {
  const { collectedMessagesCollection } = options

  // Extract approvals from each message's collected rows
  // fn.select can return an array which will be flattened
  return createLiveQueryCollection((q) =>
    q
      .from({ collected: collectedMessagesCollection })
      .fn.select(({ collected }) => extractApprovals(collected.rows))
  )
}
