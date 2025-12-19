/**
 * Test utilities for @electric-sql/ai-db.
 *
 * Provides mock stream controllers and fixtures for testing the live query pipeline.
 */

import { createCollection } from '@tanstack/db'
import type { Collection, SyncConfig, ChangeMessage } from '@tanstack/db'
import type { ChunkRow, PresenceRow, AgentRow } from '../../src/schema'
import type { SessionDB } from '../../src/collection'
import type { StreamRow } from '../../src/types'
import testDataJson from './test-data.json'

// ============================================================================
// Types
// ============================================================================

/**
 * Mock controller for controlling chunk emissions in tests.
 */
export interface MockChunksController {
  /** Emit rows to the collection as inserts */
  emit: (rows: ChunkRow[]) => void
  /** Mark collection as ready (initial sync complete) */
  markReady: () => void
  /** Get low-level sync functions for direct control */
  utils: {
    begin: () => void
    write: (change: ChangeMessage<ChunkRow>) => void
    commit: () => void
    markReady: () => void
  }
}

// ============================================================================
// Mock Chunks Collection Factory
// ============================================================================

/**
 * Creates a mock chunks collection for testing.
 *
 * This mimics the real stream-db collection but with controlled sync.
 * Uses the same pattern as TanStack DB's mockSyncCollectionOptions.
 */
export function createMockChunksCollection(
  sessionId: string
): {
  collection: Collection<ChunkRow>
  controller: MockChunksController
} {
  let begin!: () => void
  let write!: (change: ChangeMessage<ChunkRow>) => void
  let commit!: () => void
  let markReadyFn!: () => void

  const sync: SyncConfig<ChunkRow>['sync'] = (params) => {
    begin = params.begin
    write = params.write
    commit = params.commit
    markReadyFn = params.markReady
  }

  const collection = createCollection<ChunkRow>({
    id: `test-chunks:${sessionId}`,
    getKey: (row) => row.id,
    sync: { sync },
  })

  const controller: MockChunksController = {
    emit: (rows: ChunkRow[]) => {
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
// Generic Mock Collection Factory
// ============================================================================

/**
 * Generic mock controller for controlling any collection in tests.
 */
export interface MockCollectionController<T extends object> {
  /** Emit rows to the collection as inserts */
  emit: (rows: T[]) => void
  /** Mark collection as ready (initial sync complete) */
  markReady: () => void
  /** Get low-level sync functions for direct control */
  utils: {
    begin: () => void
    write: (change: ChangeMessage<T>) => void
    commit: () => void
    markReady: () => void
  }
}

/**
 * Creates a generic mock collection for testing.
 */
function createMockCollection<T extends object>(
  id: string,
  getKey: (row: T) => string
): {
  collection: Collection<T>
  controller: MockCollectionController<T>
} {
  let begin!: () => void
  let write!: (change: ChangeMessage<T>) => void
  let commit!: () => void
  let markReadyFn!: () => void

  const sync: SyncConfig<T>['sync'] = (params) => {
    begin = params.begin
    write = params.write
    commit = params.commit
    markReadyFn = params.markReady
  }

  const collection = createCollection<T>({
    id,
    getKey,
    sync: { sync },
  })

  const controller: MockCollectionController<T> = {
    emit: (rows: T[]) => {
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
// Mock SessionDB Factory
// ============================================================================

/**
 * Controllers for all collections in a mock SessionDB.
 */
export interface MockSessionDBControllers {
  chunks: MockChunksController
  presence: MockCollectionController<PresenceRow>
  agents: MockCollectionController<AgentRow>
}

/**
 * Creates a mock SessionDB for testing.
 *
 * This creates a complete mock SessionDB with all three root collections
 * (chunks, presence, agents) controlled by test code. This replaces the
 * previous `chunksCollection` injection pattern.
 *
 * @example
 * ```typescript
 * const { sessionDB, controllers } = createMockSessionDB('test-session')
 *
 * const client = new DurableChatClient({
 *   sessionId: 'test-session',
 *   proxyUrl: 'http://localhost:4000',
 *   sessionDB, // Inject mock SessionDB
 * })
 *
 * await client.connect()
 *
 * // Emit test data via controllers
 * controllers.chunks.emit(testChunkRows)
 * controllers.chunks.markReady()
 * ```
 */
export function createMockSessionDB(sessionId: string): {
  sessionDB: SessionDB
  controllers: MockSessionDBControllers
} {
  // Create mock collections for all three root collections
  const {
    collection: chunksCollection,
    controller: chunksController,
  } = createMockChunksCollection(sessionId)

  const {
    collection: presenceCollection,
    controller: presenceController,
  } = createMockCollection<PresenceRow>(
    `test-presence:${sessionId}`,
    (row) => row.actorId
  )

  const {
    collection: agentsCollection,
    controller: agentsController,
  } = createMockCollection<AgentRow>(
    `test-agents:${sessionId}`,
    (row) => row.agentId
  )

  // Create mock SessionDB object
  const sessionDB: SessionDB = {
    collections: {
      chunks: chunksCollection,
      presence: presenceCollection,
      agents: agentsCollection,
    },
    // Stream is not used in tests
    stream: null as any,
    // Preload triggers collection preload and marks them ready
    preload: async () => {
      // Trigger preload on collections (this sets up the sync callbacks)
      chunksCollection.preload()
      presenceCollection.preload()
      agentsCollection.preload()
      // Mark all collections as ready
      chunksController.markReady()
      presenceController.markReady()
      agentsController.markReady()
    },
    // Close is a no-op in tests
    close: () => {},
    // Utils for awaiting txids
    utils: {
      // Resolve immediately in tests (no real sync)
      awaitTxId: async () => {},
    },
  }

  return {
    sessionDB,
    controllers: {
      chunks: chunksController,
      presence: presenceController,
      agents: agentsController,
    },
  }
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
 * Convert legacy StreamRow to ChunkRow format.
 *
 * Transforms:
 * - `actorType: 'user' | 'agent'` -> `role: 'user' | 'assistant'`
 * - Adds `id: ${messageId}:${seq}` (the primary key)
 * - Removes `sessionId` (not in ChunkRow)
 */
export function streamRowToChunkRow(row: StreamRow): ChunkRow {
  const role = row.actorType === 'user' ? 'user' : 'assistant'
  return {
    id: `${row.messageId}:${row.seq}`,
    messageId: row.messageId,
    actorId: row.actorId,
    role,
    chunk: row.chunk,
    seq: row.seq,
    createdAt: row.createdAt,
  }
}

/**
 * Convert an array of legacy StreamRows to ChunkRows.
 */
export function streamRowsToChunkRows(rows: StreamRow[]): ChunkRow[] {
  return rows.map(streamRowToChunkRow)
}

/**
 * Get rows for a specific message from test data as ChunkRows.
 *
 * @param testData - All test data rows (StreamRow format)
 * @param messageId - Message ID to filter by
 * @returns ChunkRows for the specified message
 */
export function getMessageRows(
  testData: StreamRow[],
  messageId: string
): ChunkRow[] {
  return testData
    .filter((row) => row.messageId === messageId)
    .map(streamRowToChunkRow)
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
