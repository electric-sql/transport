/**
 * Minimal reproduction test for TanStack DB optimistic state on derived collections.
 *
 * This test isolates the core behavior to determine if the bug is:
 * 1. A core TanStack DB issue with optimistic state on live query collections
 * 2. Specific to our implementation (pipeline complexity, aggregation, etc.)
 *
 * The bug: Synced data from the pipeline doesn't appear in a derived collection
 * while there's a pending optimistic mutation on that collection.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createCollection,
  createLiveQueryCollection,
  createOptimisticAction,
} from '@tanstack/db'
import type { Collection, ChangeMessage } from '@tanstack/db'

// =============================================================================
// Test Setup - Minimal Types
// =============================================================================

interface SourceItem {
  id: string
  value: string
  timestamp: number
}

interface DerivedItem {
  id: string
  value: string
  timestamp: number
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a mock source collection with controllable sync.
 */
function createMockSourceCollection(collectionId: string) {
  let begin: () => void
  let write: (change: ChangeMessage<SourceItem>) => void
  let commit: () => void
  let markReadyFn: () => void

  const collection = createCollection<SourceItem>({
    id: collectionId,
    getKey: (item) => item.id,
    startSync: true, // Start sync immediately
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        markReadyFn = params.markReady
      },
    },
  })

  const controller = {
    emit: (items: SourceItem[]) => {
      begin!()
      for (const item of items) {
        write!({ type: 'insert', value: item })
      }
      commit!()
    },
    update: (item: SourceItem) => {
      begin!()
      write!({ type: 'update', value: item })
      commit!()
    },
    markReady: () => markReadyFn!(),
  }

  return { collection, controller }
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 40))
}

// =============================================================================
// Minimal Reproduction Tests
// =============================================================================

describe('TanStack DB: optimistic state on derived collections', () => {
  describe('MINIMAL: simple derived collection (no aggregation)', () => {
    /**
     * This is the simplest possible case:
     * - Source collection with items
     * - Derived collection via createLiveQueryCollection (just a passthrough)
     * - Optimistic insert into derived collection
     * - Sync new item into source while optimistic mutation is pending
     */
    it('should show synced items while optimistic mutation is pending', async () => {
      // Setup: source collection
      const { collection: source, controller } = createMockSourceCollection(
        'minimal-source-1'
      )

      // Setup: derived collection (simple passthrough, no transformation)
      const derived = createLiveQueryCollection<DerivedItem>({
        query: (q) => q.from({ item: source }),
        getKey: (item) => item.id,
        startSync: true,
      })

      // Mark ready and wait
      controller.markReady()
      await flushPromises()

      // Create optimistic action for the derived collection
      let resolveOptimistic: () => void
      const optimisticInsert = createOptimisticAction<DerivedItem>({
        onMutate: (item) => {
          derived.insert(item)
        },
        mutationFn: async () => {
          // Wait until we explicitly resolve
          await new Promise<void>((resolve) => {
            resolveOptimistic = resolve
          })
        },
      })

      // Step 1: Insert optimistic item (mutation will be PENDING)
      optimisticInsert({
        id: 'optimistic-1',
        value: 'optimistic value',
        timestamp: 1000,
      })
      await flushPromises()

      expect(derived.size).toBe(1)
      expect(derived.has('optimistic-1')).toBe(true)

      // Step 2: Sync a NEW item into source collection (while optimistic is pending)
      controller.emit([{ id: 'synced-1', value: 'synced value', timestamp: 2000 }])
      await flushPromises()

      // CRITICAL TEST: Both items should be visible
      // - optimistic-1: from optimistic insert
      // - synced-1: from pipeline (source → derived)
      expect(derived.size).toBe(2)
      expect(derived.has('optimistic-1')).toBe(true)
      expect(derived.has('synced-1')).toBe(true)

      // Step 3: Resolve optimistic mutation
      resolveOptimistic!()
      await flushPromises()

      // After resolve, optimistic item disappears (no synced equivalent)
      // synced-1 should remain
      expect(derived.has('synced-1')).toBe(true)
    })

    it('should show synced items that match optimistic key while mutation is pending', async () => {
      // This tests the reconciliation case:
      // - Optimistic insert with key X
      // - Sync item with SAME key X (should reconcile)
      // - Sync item with DIFFERENT key Y (should appear)

      const { collection: source, controller } = createMockSourceCollection(
        'minimal-source-2'
      )

      const derived = createLiveQueryCollection<DerivedItem>({
        query: (q) => q.from({ item: source }),
        getKey: (item) => item.id,
        startSync: true,
      })

      controller.markReady()
      await flushPromises()

      let resolveOptimistic: () => void
      const optimisticInsert = createOptimisticAction<DerivedItem>({
        onMutate: (item) => {
          derived.insert(item)
        },
        mutationFn: async () => {
          await new Promise<void>((resolve) => {
            resolveOptimistic = resolve
          })
        },
      })

      // Step 1: Insert optimistic item with id='user-1'
      optimisticInsert({
        id: 'user-1',
        value: 'optimistic user message',
        timestamp: 1000,
      })
      await flushPromises()

      expect(derived.size).toBe(1)
      expect(derived.has('user-1')).toBe(true)

      // Step 2: Sync SAME item (reconciliation) AND a different item
      controller.emit([
        { id: 'user-1', value: 'synced user message', timestamp: 1000 },
        { id: 'assistant-1', value: 'synced assistant message', timestamp: 2000 },
      ])
      await flushPromises()

      // CRITICAL: Both items should be visible
      expect(derived.size).toBe(2)
      expect(derived.has('user-1')).toBe(true)
      expect(derived.has('assistant-1')).toBe(true)

      // Resolve and verify final state
      resolveOptimistic!()
      await flushPromises()

      expect(derived.size).toBe(2)
      expect(derived.has('user-1')).toBe(true)
      expect(derived.has('assistant-1')).toBe(true)
    })
  })

  describe('WITH ORDERBY: derived collection with orderBy', () => {
    /**
     * Our actual pipeline uses orderBy. This tests if orderBy affects
     * the visibility of synced items during pending optimistic state.
     */
    it('should show synced items with orderBy while mutation is pending', async () => {
      const { collection: source, controller } = createMockSourceCollection(
        'orderby-source-1'
      )

      // Derived collection WITH orderBy (like our messages collection)
      const derived = createLiveQueryCollection<DerivedItem>({
        query: (q) =>
          q.from({ item: source }).orderBy(({ item }) => item.timestamp, 'asc'),
        getKey: (item) => item.id,
        startSync: true,
      })

      controller.markReady()
      await flushPromises()

      let resolveOptimistic: () => void
      const optimisticInsert = createOptimisticAction<DerivedItem>({
        onMutate: (item) => {
          derived.insert(item)
        },
        mutationFn: async () => {
          await new Promise<void>((resolve) => {
            resolveOptimistic = resolve
          })
        },
      })

      // Step 1: Optimistic insert
      optimisticInsert({
        id: 'user-1',
        value: 'optimistic',
        timestamp: 1000,
      })
      await flushPromises()

      expect(derived.size).toBe(1)

      // Step 2: Sync same item + new item while pending
      controller.emit([
        { id: 'user-1', value: 'synced user', timestamp: 1000 },
        { id: 'assistant-1', value: 'synced assistant', timestamp: 2000 },
      ])
      await flushPromises()

      expect(derived.size).toBe(2)
      expect(derived.has('user-1')).toBe(true)
      expect(derived.has('assistant-1')).toBe(true)

      // Verify ordering
      const items = [...derived.values()]
      expect(items[0].id).toBe('user-1')
      expect(items[1].id).toBe('assistant-1')

      resolveOptimistic!()
      await flushPromises()
    })
  })

  describe('WITH SELECT: derived collection with fn.select', () => {
    /**
     * Our pipeline uses fn.select to transform items. This tests if
     * the select transformation affects visibility.
     */
    it('should show synced items with fn.select while mutation is pending', async () => {
      const { collection: source, controller } = createMockSourceCollection(
        'select-source-1'
      )

      // Derived collection WITH fn.select (transformation)
      const derived = createLiveQueryCollection<DerivedItem>({
        query: (q) =>
          q
            .from({ item: source })
            .orderBy(({ item }) => item.timestamp, 'asc')
            .fn.select(({ item }) => {
              // Transform: add a prefix to value
              return {
                id: item.id,
                value: `[processed] ${item.value}`,
                timestamp: item.timestamp,
              }
            }),
        getKey: (item) => item.id,
        startSync: true,
      })

      controller.markReady()
      await flushPromises()

      let resolveOptimistic: () => void
      const optimisticInsert = createOptimisticAction<DerivedItem>({
        onMutate: (item) => {
          derived.insert(item)
        },
        mutationFn: async () => {
          await new Promise<void>((resolve) => {
            resolveOptimistic = resolve
          })
        },
      })

      // Step 1: Optimistic insert (note: we insert the "processed" format)
      optimisticInsert({
        id: 'user-1',
        value: '[processed] optimistic',
        timestamp: 1000,
      })
      await flushPromises()

      expect(derived.size).toBe(1)

      // Step 2: Sync items (raw format, will be transformed by fn.select)
      controller.emit([
        { id: 'user-1', value: 'synced user', timestamp: 1000 },
        { id: 'assistant-1', value: 'synced assistant', timestamp: 2000 },
      ])
      await flushPromises()

      expect(derived.size).toBe(2)
      expect(derived.has('user-1')).toBe(true)
      expect(derived.has('assistant-1')).toBe(true)

      resolveOptimistic!()
      await flushPromises()
    })
  })

  describe('TWO-STAGE PIPELINE: groupBy + collect → orderBy + select', () => {
    /**
     * This mimics our actual pipeline more closely:
     * source → intermediate (groupBy/collect) → final (orderBy/select)
     *
     * Optimistic insert happens on the FINAL collection.
     */
    it('should show synced items in two-stage pipeline while mutation is pending', async () => {
      // Source collection
      const { collection: source, controller } = createMockSourceCollection(
        'twostage-source-1'
      )

      // Stage 1: Intermediate collection (simulating groupBy + collect)
      // For simplicity, we just pass through (the groupBy is complex to mock)
      const intermediate = createLiveQueryCollection<SourceItem>({
        query: (q) => q.from({ item: source }),
        getKey: (item) => item.id,
        startSync: true,
      })

      // Stage 2: Final collection (orderBy + select on intermediate)
      const final = createLiveQueryCollection<DerivedItem>({
        query: (q) =>
          q
            .from({ item: intermediate })
            .orderBy(({ item }) => item.timestamp, 'asc')
            .fn.select(({ item }) => ({
              id: item.id,
              value: `[final] ${item.value}`,
              timestamp: item.timestamp,
            })),
        getKey: (item) => item.id,
        startSync: true,
      })

      controller.markReady()
      await flushPromises()

      let resolveOptimistic: () => void
      const optimisticInsert = createOptimisticAction<DerivedItem>({
        onMutate: (item) => {
          final.insert(item)
        },
        mutationFn: async () => {
          await new Promise<void>((resolve) => {
            resolveOptimistic = resolve
          })
        },
      })

      // Step 1: Optimistic insert into FINAL collection
      optimisticInsert({
        id: 'user-1',
        value: '[final] optimistic',
        timestamp: 1000,
      })
      await flushPromises()

      expect(final.size).toBe(1)

      // Step 2: Sync into SOURCE while mutation is pending on FINAL
      controller.emit([
        { id: 'user-1', value: 'synced user', timestamp: 1000 },
        { id: 'assistant-1', value: 'synced assistant', timestamp: 2000 },
      ])
      await flushPromises()

      // CRITICAL: Both should be visible
      expect(final.size).toBe(2)
      expect(final.has('user-1')).toBe(true)
      expect(final.has('assistant-1')).toBe(true)

      resolveOptimistic!()
      await flushPromises()
    })
  })

  describe('STREAMING: items arrive one at a time', () => {
    /**
     * This tests the streaming scenario where items arrive incrementally
     * while optimistic mutation is pending.
     */
    it('should show each streamed item while mutation is pending', async () => {
      const { collection: source, controller } = createMockSourceCollection(
        'streaming-source-1'
      )

      const derived = createLiveQueryCollection<DerivedItem>({
        query: (q) =>
          q.from({ item: source }).orderBy(({ item }) => item.timestamp, 'asc'),
        getKey: (item) => item.id,
        startSync: true,
      })

      controller.markReady()
      await flushPromises()

      let resolveOptimistic: () => void
      const optimisticInsert = createOptimisticAction<DerivedItem>({
        onMutate: (item) => {
          derived.insert(item)
        },
        mutationFn: async () => {
          await new Promise<void>((resolve) => {
            resolveOptimistic = resolve
          })
        },
      })

      // Step 1: Optimistic insert
      optimisticInsert({
        id: 'user-1',
        value: 'optimistic',
        timestamp: 1000,
      })
      await flushPromises()
      expect(derived.size).toBe(1)

      // Step 2: Sync user-1 (reconciliation)
      controller.emit([{ id: 'user-1', value: 'synced user', timestamp: 1000 }])
      await flushPromises()

      expect(derived.size).toBe(1)
      expect(derived.has('user-1')).toBe(true)

      // Step 3: Stream assistant chunks one at a time
      for (let i = 1; i <= 3; i++) {
        controller.emit([
          { id: 'assistant-1', value: `chunk ${i}`, timestamp: 2000 },
        ])
        await flushPromises()

        // CRITICAL: Both items should be visible after each chunk
        expect(derived.size).toBe(2)
        expect(derived.has('user-1')).toBe(true)
        expect(derived.has('assistant-1')).toBe(true)
      }

      resolveOptimistic!()
      await flushPromises()
    })
  })
})
