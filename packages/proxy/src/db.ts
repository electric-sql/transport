import { Pool } from 'pg'
import { databasePoolSize, databaseUrl } from './config'

export const pool = new Pool({
  connectionString: databaseUrl,
  max: databasePoolSize,
})

const migrations = `
  CREATE TABLE IF NOT EXISTS data_chunks (
    id BIGSERIAL PRIMARY KEY,
    session UUID NOT NULL,
    request UUID NOT NULL,
    data TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS control_messages (
    id BIGSERIAL PRIMARY KEY,
    session UUID NOT NULL,
    request UUID NOT NULL,
    event TEXT NOT NULL,
    data_row_id TEXT,
    payload JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS data_chunks_idx ON data_chunks(session, request);
  CREATE INDEX IF NOT EXISTS control_messages_idx ON control_messages(session, request);
`

export async function applyMigrations(): Promise<void> {
  const client = await pool.connect()

  try {
    await client.query(migrations)
  } finally {
    client.release()
  }
}

/**
 * Insert a data chunk and return the row ID as a zero-padded string
 * for lexicographic sorting.
 */
export async function insertDataChunk(
  session: string,
  request: string,
  data: string
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO data_chunks (session, request, data)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [session, request, data]
  )
  // Return row ID as zero-padded string for lexicographic sorting
  return result.rows[0].id.toString().padStart(20, `0`)
}

/**
 * Insert a control message with the data row ID for synchronization.
 */
export async function insertControlMessage(
  session: string,
  request: string,
  event: `done` | `error` | `heartbeat`,
  dataRowId: string,
  payload?: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `INSERT INTO control_messages (session, request, event, data_row_id, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [session, request, event, dataRowId, payload ?? null]
  )
}
