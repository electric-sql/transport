import { Pool } from 'pg'
import { databasePoolSize, databaseUrl } from './config'

export const pool = new Pool({
  connectionString: databaseUrl,
  max: databasePoolSize
})

const migrations = `
  CREATE TABLE IF NOT EXISTS chunks (
    id BIGSERIAL PRIMARY KEY,
    session UUID NOT NULL,
    request UUID NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS chunks_idx ON chunks(
    session, request
  );
`

export async function applyMigrations(): Promise<void> {
  const client = await pool.connect()

  try {
    await client.query(migrations)
  } finally {
    client.release()
  }
}

export async function insertChunks(session: string, request: string, chunks: string[]): Promise<void> {
  if (chunks.length === 0) return

  await pool.query(
    `INSERT INTO chunks (session, request, data) SELECT $1, $2, unnest($3::text[])::jsonb`,
    [session, request, chunks]
  )
}
