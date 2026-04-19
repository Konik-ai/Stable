import SpritesWorker from './sprites.worker?worker'
import type { Route } from './types'

type SpriteResult = {
  segmentBlobs: Blob[]
  lastTileBlob: Blob | null
}

export type RouteSprites = {
  segmentUrls: string[]
  lastTileUrl: string | null
}

type WorkerResponse = { id: number; result?: SpriteResult; error?: string }

// Mirrors events-worker-client's throttling. Sprite fetches share the browser's
// connection pool with events.json and /routes pagination — without a cap, fast
// scroll bursts saturate the pool and block the next page of routes.
const MAX_CONCURRENT_WORKER_REQUESTS = 4
const MAX_QUEUE_SIZE = 16

type PendingEntry = {
  resolve: (r: RouteSprites) => void
  reject: (e: unknown) => void
  cancelled: boolean
}

type QueueEntry = {
  route: Route
  pending: PendingEntry
  cancelled: boolean
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, PendingEntry>()
let activeCount = 0
const waiting: QueueEntry[] = []

function enqueue(entry: QueueEntry) {
  waiting.push(entry)
  while (waiting.length > MAX_QUEUE_SIZE) {
    const evicted = waiting.shift()
    if (!evicted || evicted.cancelled) continue
    evicted.cancelled = true
    evicted.pending.cancelled = true
    evicted.pending.reject(new CancelledError('evicted from queue'))
  }
}

function pumpQueue() {
  while (activeCount < MAX_CONCURRENT_WORKER_REQUESTS && waiting.length > 0) {
    const entry = waiting.pop()
    if (!entry) break
    if (entry.cancelled) continue
    activeCount++
    dispatch(entry)
  }
}

function dispatch(entry: QueueEntry) {
  const id = nextId++
  const plainRoute = JSON.parse(JSON.stringify(entry.route)) as Route
  pending.set(id, entry.pending)
  try {
    getWorker().postMessage({ id, route: plainRoute })
  } catch (err) {
    console.error('[sprites-worker-client] postMessage threw', err)
    pending.delete(id)
    activeCount--
    entry.pending.reject(err)
    pumpQueue()
  }
}

function blobsToUrls(result: SpriteResult): RouteSprites {
  return {
    segmentUrls: result.segmentBlobs.map((b) => URL.createObjectURL(b)),
    lastTileUrl: result.lastTileBlob ? URL.createObjectURL(result.lastTileBlob) : null,
  }
}

function getWorker(): Worker {
  if (worker) return worker
  worker = new SpritesWorker()
  worker.addEventListener('message', (e: MessageEvent<WorkerResponse>) => {
    const entry = pending.get(e.data.id)
    if (!entry) return
    pending.delete(e.data.id)
    activeCount--
    if (!entry.cancelled) {
      if (e.data.error !== undefined) {
        entry.reject(new Error(e.data.error))
      } else if (e.data.result) {
        entry.resolve(blobsToUrls(e.data.result))
      } else {
        entry.resolve({ segmentUrls: [], lastTileUrl: null })
      }
    }
    pumpQueue()
  })
  worker.addEventListener('error', (e) => {
    console.error('[sprites-worker-client] worker error', e.message, e.filename, e.lineno)
    const err = new Error(e.message || 'worker crashed')
    for (const entry of pending.values()) {
      if (!entry.cancelled) entry.reject(err)
    }
    pending.clear()
    activeCount = 0
    worker?.terminate()
    worker = null
    pumpQueue()
  })
  return worker
}

export class CancelledError extends Error {
  constructor(message = 'cancelled') {
    super(message)
    this.name = 'CancelledError'
  }
}

export type RouteSpritesRequest = {
  promise: Promise<RouteSprites>
  cancel: () => void
}

export function getRouteSpritesInWorker(route: Route): RouteSpritesRequest {
  const pendingEntry: PendingEntry = {
    resolve: () => {},
    reject: () => {},
    cancelled: false,
  }
  const promise = new Promise<RouteSprites>((resolve, reject) => {
    pendingEntry.resolve = resolve
    pendingEntry.reject = reject
  })
  const queueEntry: QueueEntry = { route, pending: pendingEntry, cancelled: false }
  enqueue(queueEntry)
  pumpQueue()
  return {
    promise,
    cancel: () => {
      if (queueEntry.cancelled) return
      queueEntry.cancelled = true
      pendingEntry.cancelled = true
      pendingEntry.reject(new CancelledError())
    },
  }
}
