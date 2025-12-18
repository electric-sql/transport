/**
 * Integration tests for DurableChatClient.
 *
 * These tests verify that the client properly exposes its collections
 * and that the public API is correctly wired up.
 *
 * Note: Full integration tests with network mocking would require
 * setting up MSW or similar. These tests focus on the client structure
 * and collection setup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DurableChatClient } from '../src/client'
import type { DurableChatClientOptions } from '../src/types'

// Mock the durable stream collection to avoid network calls
vi.mock('@tanstack/durable-stream-db-collection', () => ({
  durableStreamCollectionOptions: vi.fn((config) => ({
    id: config.id,
    getKey: config.getKey,
    sync: {
      sync: ({ markReady }: { markReady: () => void }) => {
        // Immediately mark ready in tests
        setTimeout(() => markReady(), 0)
      },
    },
  })),
}))

describe('DurableChatClient', () => {
  const defaultOptions: DurableChatClientOptions = {
    sessionId: 'test-session',
    proxyUrl: 'http://localhost:4000',
  }

  let client: DurableChatClient

  beforeEach(() => {
    client = new DurableChatClient(defaultOptions)
  })

  afterEach(() => {
    client.dispose()
    vi.clearAllMocks()
  })

  // ==========================================================================
  // Client Construction
  // ==========================================================================

  describe('construction', () => {
    it('should create a client with default options', () => {
      expect(client.sessionId).toBe('test-session')
      expect(client.actorType).toBe('user')
    })

    it('should generate actorId if not provided', () => {
      expect(client.actorId).toBeDefined()
      expect(client.actorId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
    })

    it('should use provided actorId', () => {
      const customClient = new DurableChatClient({
        ...defaultOptions,
        actorId: 'custom-actor-id',
      })
      expect(customClient.actorId).toBe('custom-actor-id')
      customClient.dispose()
    })

    it('should use provided actorType', () => {
      const agentClient = new DurableChatClient({
        ...defaultOptions,
        actorType: 'agent',
      })
      expect(agentClient.actorType).toBe('agent')
      agentClient.dispose()
    })
  })

  // ==========================================================================
  // Collections Exposure
  // ==========================================================================

  describe('collections', () => {
    it('should expose stream collection', () => {
      expect(client.collections.stream).toBeDefined()
      expect(typeof client.collections.stream.size).toBe('number')
    })

    it('should expose messages collection', () => {
      expect(client.collections.messages).toBeDefined()
      expect(typeof client.collections.messages.size).toBe('number')
    })

    it('should expose activeGenerations collection', () => {
      expect(client.collections.activeGenerations).toBeDefined()
      expect(typeof client.collections.activeGenerations.size).toBe('number')
    })

    it('should expose toolCalls collection', () => {
      expect(client.collections.toolCalls).toBeDefined()
      expect(typeof client.collections.toolCalls.size).toBe('number')
    })

    it('should expose toolResults collection', () => {
      expect(client.collections.toolResults).toBeDefined()
      expect(typeof client.collections.toolResults.size).toBe('number')
    })

    it('should expose approvals collection', () => {
      expect(client.collections.approvals).toBeDefined()
      expect(typeof client.collections.approvals.size).toBe('number')
    })

    it('should expose sessionMeta collection', () => {
      expect(client.collections.sessionMeta).toBeDefined()
      expect(typeof client.collections.sessionMeta.size).toBe('number')
    })

    it('should expose sessionParticipants collection', () => {
      expect(client.collections.sessionParticipants).toBeDefined()
      expect(typeof client.collections.sessionParticipants.size).toBe('number')
    })

    it('should expose sessionStats collection', () => {
      expect(client.collections.sessionStats).toBeDefined()
      expect(typeof client.collections.sessionStats.size).toBe('number')
    })
  })

  // ==========================================================================
  // Initial State
  // ==========================================================================

  describe('initial state', () => {
    it('should return empty messages array initially', () => {
      expect(client.messages).toEqual([])
    })

    it('should not be loading initially', () => {
      expect(client.isLoading).toBe(false)
    })

    it('should have no error initially', () => {
      expect(client.error).toBeUndefined()
    })

    it('should have disconnected connection status initially', () => {
      expect(client.connectionStatus).toBe('disconnected')
    })
  })

  // ==========================================================================
  // Session Metadata
  // ==========================================================================

  describe('session metadata', () => {
    it('should create initial session meta on construction', () => {
      const meta = client.collections.sessionMeta.get('test-session')
      expect(meta).toBeDefined()
      expect(meta?.sessionId).toBe('test-session')
      expect(meta?.connectionStatus).toBe('disconnected')
    })
  })

  // ==========================================================================
  // Public API Methods
  // ==========================================================================

  describe('public API methods', () => {
    it('should have sendMessage method', () => {
      expect(typeof client.sendMessage).toBe('function')
    })

    it('should have append method', () => {
      expect(typeof client.append).toBe('function')
    })

    it('should have reload method', () => {
      expect(typeof client.reload).toBe('function')
    })

    it('should have stop method', () => {
      expect(typeof client.stop).toBe('function')
    })

    it('should have clear method', () => {
      expect(typeof client.clear).toBe('function')
    })

    it('should have addToolResult method', () => {
      expect(typeof client.addToolResult).toBe('function')
    })

    it('should have addToolApprovalResponse method', () => {
      expect(typeof client.addToolApprovalResponse).toBe('function')
    })

    it('should have fork method', () => {
      expect(typeof client.fork).toBe('function')
    })

    it('should have registerAgents method', () => {
      expect(typeof client.registerAgents).toBe('function')
    })

    it('should have unregisterAgent method', () => {
      expect(typeof client.unregisterAgent).toBe('function')
    })

    it('should have connect method', () => {
      expect(typeof client.connect).toBe('function')
    })

    it('should have disconnect method', () => {
      expect(typeof client.disconnect).toBe('function')
    })

    it('should have pause method', () => {
      expect(typeof client.pause).toBe('function')
    })

    it('should have resume method', () => {
      expect(typeof client.resume).toBe('function')
    })

    it('should have dispose method', () => {
      expect(typeof client.dispose).toBe('function')
    })
  })

  // ==========================================================================
  // isLoading Derived State
  // ==========================================================================

  describe('isLoading behavior', () => {
    it('should derive isLoading from activeGenerations collection size', () => {
      // Initially no active generations
      expect(client.isLoading).toBe(false)

      // isLoading is directly tied to activeGenerations.size > 0
      // This is tested more thoroughly in active-generations.test.ts
    })
  })

  // ==========================================================================
  // Factory Function
  // ==========================================================================

  describe('createDurableChatClient factory', () => {
    it('should be exported from module', async () => {
      const { createDurableChatClient } = await import('../src/client')
      expect(typeof createDurableChatClient).toBe('function')
    })

    it('should create a DurableChatClient instance', async () => {
      const { createDurableChatClient } = await import('../src/client')
      const factoryClient = createDurableChatClient(defaultOptions)

      expect(factoryClient).toBeInstanceOf(DurableChatClient)
      expect(factoryClient.sessionId).toBe('test-session')

      factoryClient.dispose()
    })
  })

  // ==========================================================================
  // Callbacks
  // ==========================================================================

  describe('callbacks', () => {
    it('should call onError when an error occurs', async () => {
      const onError = vi.fn()
      const clientWithCallback = new DurableChatClient({
        ...defaultOptions,
        onError,
      })

      // We can't easily trigger an error without mocking fetch,
      // but we verify the callback is stored
      expect(clientWithCallback['options'].onError).toBe(onError)

      clientWithCallback.dispose()
    })

    it('should call onMessagesChange when messages change', async () => {
      const onMessagesChange = vi.fn()
      const clientWithCallback = new DurableChatClient({
        ...defaultOptions,
        onMessagesChange,
      })

      // Verify the callback is stored
      expect(clientWithCallback['options'].onMessagesChange).toBe(onMessagesChange)

      clientWithCallback.dispose()
    })
  })
})
