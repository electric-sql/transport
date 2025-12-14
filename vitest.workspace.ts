import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    test: {
      name: 'proxy',
      root: './packages/proxy',
      globals: true,
      environment: 'node',
      include: ['test/**/*.test.ts'],
      globalSetup: './test/setup.ts',
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.d.ts'],
      },
    },
  },
  {
    test: {
      name: 'transport',
      root: './packages/transport',
      globals: true,
      environment: 'node',
      include: ['test/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.d.ts'],
      },
    },
  },
  {
    test: {
      name: 'ai-db',
      root: './packages/ai-db',
      globals: true,
      environment: 'node',
      include: ['tests/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.d.ts'],
      },
    },
  },
  {
    test: {
      name: 'react-ai-db',
      root: './packages/react-ai-db',
      globals: true,
      environment: 'jsdom',
      include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
      setupFiles: ['./tests/setup.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.d.ts'],
      },
    },
  },
])
