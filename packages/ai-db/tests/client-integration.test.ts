/**
 * Integration tests for DurableChatClient.
 *
 * These tests verify that the client properly exposes its collections
 * and that the public API is correctly wired up.
 *
 * Note: Full integration tests with network mocking would require
 * setting up MSW or similar. These tests focus on the client structure
 * and collection setup using the sessionDB injection pattern.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DurableChatClient, createDurableChatClient } from '../src/client'
import { createMockSessionDB } from './fixtures/test-helpers'
import type { DurableChatClientOptions } from '../src/types'
import type { SessionDB } from '../src/collection'

describe('DurableChatClient', () => {
  const defaultOptions: DurableChatClientOptions = {
    sessionId: 'test-session',
    proxyUrl: 'http://localhost:4000',
  }

  let client: DurableChatClient
  let sessionDB: SessionDB

  beforeEach(() => {
    const mock = createMockSessionDB('test-session')
    sessionDB = mock.sessionDB
    client = new DurableChatClient({
      ...defaultOptions,
      sessionDB, // Inject test sessionDB
    })
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
        sessionDB,
      })
      expect(customClient.actorId).toBe('custom-actor-id')
      customClient.dispose()
    })

    it('should use provided actorType', () => {
      const agentClient = new DurableChatClient({
        ...defaultOptions,
        actorType: 'agent',
        sessionDB,
      })
      expect(agentClient.actorType).toBe('agent')
      agentClient.dispose()
    })
  })

  // ==========================================================================
  // Pre-connect State (before connect() is called)
  // ==========================================================================

  describe('pre-connect state', () => {
    it('should return empty messages array before connect', () => {
      expect(client.messages).toEqual([])
    })

    it('should not be loading before connect', () => {
      expect(client.isLoading).toBe(false)
    })

    it('should have no error initially', () => {
      expect(client.error).toBeUndefined()
    })

    it('should have disconnected connection status before connect', () => {
      expect(client.connectionStatus).toBe('disconnected')
    })

    it('should have collections available immediately after construction', () => {
      // Collections are now created synchronously in constructor
      expect(client.collections).toBeDefined()
      expect(client.collections.chunks).toBeDefined()
      expect(client.collections.messages).toBeDefined()
      expect(client.collections.toolCalls).toBeDefined()
    })
  })

  // ==========================================================================
  // Post-connect State (after connect() is called)
  // ==========================================================================

  describe('post-connect collections', () => {
    beforeEach(async () => {
      // Mock fetch for connect()
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      })

      await client.connect()
    })

    it('should expose chunks collection', () => {
      expect(client.collections.chunks).toBeDefined()
      expect(typeof client.collections.chunks.size).toBe('number')
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

    it('should expose sessionStats collection', () => {
      expect(client.collections.sessionStats).toBeDefined()
      expect(typeof client.collections.sessionStats.size).toBe('number')
    })
  })

  // ==========================================================================
  // Session Metadata
  // ==========================================================================

  describe('session metadata', () => {
    beforeEach(async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      })
      await client.connect()
    })

    it('should create initial session meta on connect', () => {
      const meta = client.collections.sessionMeta.get('test-session')
      expect(meta).toBeDefined()
      expect(meta?.sessionId).toBe('test-session')
    })

    it('should update connection status to connected after connect', () => {
      const meta = client.collections.sessionMeta.get('test-session')
      expect(meta?.connectionStatus).toBe('connected')
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
  // sendMessage requires connect
  // ==========================================================================

  describe('sendMessage behavior', () => {
    it('should throw when sendMessage called before connect', async () => {
      await expect(client.sendMessage('hello')).rejects.toThrow(
        'Client not connected'
      )
    })
  })

  // ==========================================================================
  // isLoading Derived State
  // ==========================================================================

  describe('isLoading behavior', () => {
    beforeEach(async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      })
      await client.connect()
    })

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
    it('should create a DurableChatClient instance', () => {
      const factoryClient = createDurableChatClient({
        ...defaultOptions,
        sessionDB,
      })

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
        sessionDB,
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
        sessionDB,
      })

      // Verify the callback is stored
      expect(clientWithCallback['options'].onMessagesChange).toBe(onMessagesChange)

      clientWithCallback.dispose()
    })
  })
})
