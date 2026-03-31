import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DurableStreamTestServer } from '@durable-streams/server'
import { YjsServer } from '@durable-streams/y-durable-streams/server'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

const dsPort = Number(process.env.DS_PORT ?? 4437)
const yjsPort = Number(process.env.YJS_PORT ?? 4438)
const dataDir =
  process.env.DS_DATA_DIR ?? path.join(repoRoot, '.durable-streams-data')

const dsServer = new DurableStreamTestServer({
  port: dsPort,
  host: '127.0.0.1',
  dataDir,
})

await dsServer.start()
const yjsServer = new YjsServer({
  host: '127.0.0.1',
  port: yjsPort,
  dsServerUrl: dsServer.url,
})

const yjsUrl = await yjsServer.start()

console.log(`[durable-streams] ${dsServer.url}`)
console.log(`[durable-streams] dataDir=${dataDir}`)
console.log(`[yjs-server] ${yjsUrl}`)

const shutdown = async () => {
  await Promise.allSettled([yjsServer.stop(), dsServer.stop()])
  process.exit(0)
}

process.on('SIGINT', () => {
  void shutdown()
})
process.on('SIGTERM', () => {
  void shutdown()
})
