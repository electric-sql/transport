import cors from 'cors'
import express from 'express'
import { Readable } from 'stream'

import { proxyPort, proxyUrl } from './config'
import { handleApiRequest, handleShapeRequest } from './handlers'
import { apiRequestSchema, shapeRequestSchema } from './schema'

import { applyMigrations, pool } from './db'
await applyMigrations()

const app = express()
app.use(cors())
app.use(express.json())

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})

// Proxy requests to the developer's backend API.
app.post('/api', async (req, res) => {
  const result = apiRequestSchema.safeParse(req.body)

  if (!result.success) {
    return res.status(400).json({
      error: 'Invalid',
      details: result.error.errors
    })
  }

  const responseData = await handleApiRequest(result.data)
  res.json(responseData)
})

// Proxy requests to Electric.
app.get('/shape', async (req, res) => {
  const result = shapeRequestSchema.safeParse(req.query)

  if (!result.success) {
    return res.status(400).json({
      error: 'Invalid',
      details: result.error.errors
    })
  }

  const response = await handleShapeRequest(result.data)
  res.status(response.status)

  const headers = new Headers(response.headers)
  headers.delete(`content-encoding`)
  headers.delete(`content-length`)
  headers.forEach((value, key) => {
    res.setHeader(key, value)
  })

  Readable.fromWeb(response.body).pipe(res)
})

const server = app.listen(proxyPort, () => {
  console.log(`Server running on ${proxyUrl}`)
})

const gracefulShutdown = (signal) => {
  console.log(`${signal} received, closing server gracefully...`)

  server.close(() => {
    pool.close()

    process.exit(0)
  })

  setTimeout(() => {
    process.exit(1)
  }, 60_000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
