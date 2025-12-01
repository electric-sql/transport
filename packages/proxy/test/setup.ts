import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

const TEST_PORT = 54321

let db: PGlite
let server: PGLiteSocketServer

export async function setup() {
  db = await PGlite.create()

  server = new PGLiteSocketServer({
    db,
    port: TEST_PORT,
    host: '127.0.0.1',
  })

  await server.start()

  process.env.DATABASE_URL = `postgres://127.0.0.1:${TEST_PORT}/postgres`
}

export async function teardown() {
  await server?.stop()
  await db?.close()
}
