/**
 * Test utilities for @electric-sql/ai-db.
 *
 * Provides mock stream controllers and fixtures for testing the live query pipeline.
 */

import { createCollection } from '@tanstack/db'
import type { Collection, SyncConfig, ChangeMessage } from '@tanstack/db'
import type { StreamRowWithOffset, StreamRow } from '../../src/types'
import testDataJson from './test-data.json'

// ============================================================================
// Types
// ============================================================================

/**
 * Mock controller for controlling stream emissions in tests.
 */
export interface MockStreamController {
  /** Emit rows to the collection as inserts */
  emit: (rows: StreamRowWithOffset[]) => void
  /** Mark stream as ready (initial sync complete) */
  markReady: () => void
  /** Get low-level sync functions for direct control */
  utils: {
    begin: () => void
    write: (change: ChangeMessage<StreamRowWithOffset>) => void
    commit: () => void
    markReady: () => void
  }
}

// ============================================================================
// Mock Stream Collection Factory
// ============================================================================

/**
 * Creates a mock stream collection for testing.
 *
 * This mimics the real durableSessionStreamOptions but with controlled sync.
 * Uses the same pattern as TanStack DB's mockSyncCollectionOptions.
 */
export function createMockStreamCollection(
  sessionId: string
): {
  collection: Collection<StreamRowWithOffset>
  controller: MockStreamController
} {
  let begin!: () => void
  let write!: (change: ChangeMessage<StreamRowWithOffset>) => void
  let commit!: () => void
  let markReadyFn!: () => void

  const sync: SyncConfig<StreamRowWithOffset>['sync'] = (params) => {
    begin = params.begin
    write = params.write
    commit = params.commit
    markReadyFn = params.markReady
  }

  const collection = createCollection<StreamRowWithOffset>({
    id: `test-session-stream:${sessionId}`,
    getKey: (row) => `${row.messageId}:${row.seq}`,
    sync: { sync },
  })

  const controller: MockStreamController = {
    emit: (rows: StreamRowWithOffset[]) => {
      begin()
      for (const row of rows) {
        write({ type: 'insert', value: row })
      }
      commit()
    },
    markReady: () => {
      markReadyFn()
    },
    utils: {
      begin: () => begin(),
      write: (change) => write(change),
      commit: () => commit(),
      markReady: () => markReadyFn(),
    },
  }

  return { collection, controller }
}

// ============================================================================
// Test Data Utilities
// ============================================================================

/**
 * Load test fixtures from test-data.json.
 * Cast to StreamRow since the JSON doesn't include the offset field.
 */
export function loadTestData(): StreamRow[] {
  return testDataJson as StreamRow[]
}

/**
 * Add offset field to stream rows (simulating what the sync layer does).
 *
 * @param rows - Stream rows without offset
 * @param startOffset - Starting offset number
 * @returns Stream rows with offset field added
 */
export function addOffsets(
  rows: StreamRow[],
  startOffset: number = 0
): StreamRowWithOffset[] {
  return rows.map((row, index) => ({
    ...row,
    offset: `offset-${String(startOffset + index).padStart(10, '0')}`,
  }))
}

/**
 * Get rows for a specific message from test data.
 *
 * @param testData - All test data rows
 * @param messageId - Message ID to filter by
 * @returns Rows for the specified message
 */
export function getMessageRows(
  testData: StreamRow[],
  messageId: string
): StreamRow[] {
  return testData.filter((row) => row.messageId === messageId)
}

/**
 * Get all unique message IDs from test data in order of first appearance.
 *
 * @param testData - All test data rows
 * @returns Array of unique message IDs
 */
export function getMessageIds(testData: StreamRow[]): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const row of testData) {
    if (!seen.has(row.messageId)) {
      seen.add(row.messageId)
      ids.push(row.messageId)
    }
  }
  return ids
}

/**
 * Wait for collection to be ready.
 *
 * @param collection - Collection to wait on
 */
export async function waitForReady(
  collection: Collection<unknown>
): Promise<void> {
  await collection.stateWhenReady()
}

/**
 * Flush microtasks and timers to allow async operations to complete.
 * Wait 40ms to give live query pipelines time to propagate changes.
 */
export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 40))
}

/**
 * Subscribe to changes and collect them into an array for assertions.
 *
 * @param collection - Collection to subscribe to
 * @returns Array that accumulates changes and unsubscribe function
 */
export function collectChanges<T extends object>(
  collection: Collection<T>
): { changes: Array<{ type: string; key: string | number }>; unsubscribe: () => void } {
  const changes: Array<{ type: string; key: string | number }> = []
  const subscription = collection.subscribeChanges((changeSet) => {
    for (const change of changeSet) {
      changes.push({
        type: change.type,
        key: collection.getKeyFromItem(change.value),
      })
    }
  })
  return { changes, unsubscribe: () => subscription.unsubscribe() }
}

// ============================================================================
// Test Data Constants
// ============================================================================

/**
 * Message IDs from test-data.json for reference in tests.
 */
export const TEST_MESSAGE_IDS = {
  /** First user message: "Hello" */
  USER_1: 'a845300a-45e0-461e-9e84-20451c100833',
  /** First assistant response: "Hi there! How can I assist you today?" */
  ASSISTANT_1: '5b6a7872-7c6a-4530-8a34-0898e70e782c',
  /** Second user message: "I don't know" */
  USER_2: 'f289b345-c4ab-45fd-8b29-7b39e25e3c5d',
  /** Second assistant response: "No problem! If you have any questions..." */
  ASSISTANT_2: '6e475aba-f338-4b65-92b5-cc26f9213282',
}

/**
 * Expected message content from test data.
 */
export const EXPECTED_CONTENT = {
  USER_1: 'Hello',
  ASSISTANT_1: 'Hi there! How can I assist you today?',
  USER_2: "I don't know",
  ASSISTANT_2:
    'No problem! If you have any questions or need help with anything specific, feel free to ask.',
}
