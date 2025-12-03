#!/usr/bin/env node

import { spawn } from 'child_process'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const demosDir = join(rootDir, 'demos')

// Dynamically discover demos by reading package.json from each demos/* folder
function discoverDemos() {
  const demos = {}

  const entries = readdirSync(demosDir)
  for (const entry of entries) {
    const demoPath = join(demosDir, entry)
    const packageJsonPath = join(demoPath, 'package.json')

    try {
      if (statSync(demoPath).isDirectory() && statSync(packageJsonPath).isFile()) {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
        demos[entry] = packageJson.name
      }
    } catch {
      // Skip if not a valid demo directory
    }
  }

  return demos
}

const DEMO_PACKAGES = discoverDemos()
const DEFAULT_DEMO = 'next-openai-app'

// Get demo name from command line args
const demoName = process.argv[2] || DEFAULT_DEMO

const packageName = DEMO_PACKAGES[demoName]

if (!packageName) {
  console.error(`Unknown demo: ${demoName}`)
  console.error(`Available demos: ${Object.keys(DEMO_PACKAGES).join(', ')}`)
  process.exit(1)
}

console.log(`Starting demo: ${demoName} (${packageName})`)

const child = spawn('pnpm', ['--filter', packageName, 'dev'], {
  stdio: 'inherit',
  shell: true,
})

child.on('exit', (code) => {
  process.exit(code || 0)
})
