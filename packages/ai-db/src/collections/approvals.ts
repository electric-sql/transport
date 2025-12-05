/**
 * Approvals collection - derived livequery.
 *
 * Tracks approval requests and responses for tool calls that require user authorization.
 */

import type {
  Collection,
  LiveQueryCollectionConfig,
  StandardSchemaV1,
} from '@tanstack/db'
import type { StreamRowWithOffset, ApprovalRow, ApprovalStatus } from '../types'
import { extractApprovals } from '../materialize'

/**
 * Options for creating an approvals collection.
 */
export interface ApprovalsCollectionOptions {
  /** Session identifier */
  sessionId: string
  /** Stream collection to derive from */
  streamCollection: Collection<StreamRowWithOffset>
  /** Optional schema for validation */
  schema?: StandardSchemaV1<ApprovalRow>
}

/**
 * Creates collection config for the approvals collection.
 *
 * This is a derived livequery collection that extracts approval
 * requests and responses from stream rows. Each approval is linked
 * to its originating tool call via toolCallId.
 *
 * Approval lifecycle:
 * - pending: Approval requested, waiting for user response
 * - approved: User approved the tool call
 * - denied: User denied the tool call
 *
 * @example
 * ```typescript
 * import { createApprovalsCollectionOptions } from '@electric-sql/ai-db'
 * import { createCollection } from '@tanstack/db'
 *
 * const approvalsCollection = createCollection(
 *   createApprovalsCollectionOptions({
 *     sessionId: 'my-session',
 *     streamCollection,
 *   })
 * )
 * ```
 */
export function createApprovalsCollectionOptions(
  options: ApprovalsCollectionOptions
): LiveQueryCollectionConfig<ApprovalRow> {
  const { sessionId, streamCollection, schema } = options

  return {
    id: `session-approvals:${sessionId}`,
    schema,
    getKey: (approval) => approval.id,

    // Derived via livequery - extracts approvals from all stream rows
    query: (q) =>
      q
        .from({ row: streamCollection })
        .fn.select(({ rows }) => {
          const allRows = rows as StreamRowWithOffset[]
          return extractApprovals(allRows)
        })
        // Flatten the array of approvals
        .fn.flatMap((approvals) => approvals),
  }
}

/**
 * Get pending approvals that need user response.
 *
 * @param collection - Approvals collection
 * @returns Array of pending approvals
 */
export function getPendingApprovals(
  collection: Collection<ApprovalRow>
): ApprovalRow[] {
  const result: ApprovalRow[] = []
  for (const approval of collection.values()) {
    if (approval.status === 'pending') {
      result.push(approval)
    }
  }
  return result
}

/**
 * Get the approval for a specific tool call.
 *
 * @param collection - Approvals collection
 * @param toolCallId - Tool call identifier
 * @returns Approval or undefined
 */
export function getApprovalForToolCall(
  collection: Collection<ApprovalRow>,
  toolCallId: string
): ApprovalRow | undefined {
  for (const approval of collection.values()) {
    if (approval.toolCallId === toolCallId) {
      return approval
    }
  }
  return undefined
}

/**
 * Check if a tool call requires approval.
 *
 * @param collection - Approvals collection
 * @param toolCallId - Tool call identifier
 * @returns Whether the tool call has a pending approval
 */
export function requiresApproval(
  collection: Collection<ApprovalRow>,
  toolCallId: string
): boolean {
  const approval = getApprovalForToolCall(collection, toolCallId)
  return approval !== undefined && approval.status === 'pending'
}

/**
 * Check if a tool call is approved.
 *
 * @param collection - Approvals collection
 * @param toolCallId - Tool call identifier
 * @returns Whether the tool call is approved
 */
export function isApproved(
  collection: Collection<ApprovalRow>,
  toolCallId: string
): boolean {
  const approval = getApprovalForToolCall(collection, toolCallId)
  return approval !== undefined && approval.status === 'approved'
}

/**
 * Get approvals by status.
 *
 * @param collection - Approvals collection
 * @param status - Status to filter by
 * @returns Array of approvals with matching status
 */
export function getApprovalsByStatus(
  collection: Collection<ApprovalRow>,
  status: ApprovalStatus
): ApprovalRow[] {
  const result: ApprovalRow[] = []
  for (const approval of collection.values()) {
    if (approval.status === status) {
      result.push(approval)
    }
  }
  return result
}
