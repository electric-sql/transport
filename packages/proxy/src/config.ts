if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL environment variable is not set. ' +
    'Please add it to your .env file or environment configuration.'
  )
}

export const databaseUrl = process.env.DATABASE_URL
export const databasePoolSize = parseInt(process.env.DATABASE_POOL_SIZE || '10')

export const electricUrl = process.env.ELECTRIC_URL || 'http://localhost:3000/v1/shape'

export const proxyPort = process.env.PROXY_PORT || 4000
export const proxyUrl = process.env.PROXY_URL || `http://localhost:${proxyPort}`
