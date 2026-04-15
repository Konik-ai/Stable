import EventsWorker from './events.worker?worker'
import type { TimelineEvent } from './derived'
import type { Route } from './types'

type WorkerResponse = { id: number; timeline?: TimelineEvent[]; error?: string }

// Cap in-flight worker requests so bursts of RouteCards settling after a scroll
// don't saturate the browser's HTTP connection pool. Each worker job triggers
// ~maxqlog segment fetches against api.konik.ai — without this cap, scrolling
// causes the next /routes page request to queue behind hundreds of events.json
// fetches.
const MAX_CONCURRENT_WORKER_REQUESTS = 4

// Cap the pending queue so we don't accumulate stale work from fast-scroll
// bursts. Oldest entries are evicted when a newer one arrives — callers are
// responsible for re-queueing if the route becomes visible again.
const MAX_QUEUE_SIZE = 16

type PendingEntry = {
  resolve: (r: TimelineEvent[]) => void
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
// waiting is processed LIFO (newest first) so the routes the user is currently
// looking at win over older entries that may already be out of view.
const waiting: QueueEntry[] = []

function enqueue(entry: QueueEntry) {
  waiting.push(entry)
  // Evict from the front (oldest). Anything that's been sitting in the queue
  // the longest is most likely stale — either already cancelled or from a card
  // that has since scrolled off. The caller's promise rejects with Cancelled
  // so it doesn't leak; caller-side `.catch` swallows it.
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
  // The route comes from tanstack solid-query as a Solid store proxy, which
  // postMessage's structured clone can't serialize. JSON round-trip gives us
  // a plain object — Route is all primitives + primitive arrays, so this is lossless.
  const plainRoute = JSON.parse(JSON.stringify(entry.route)) as Route
  pending.set(id, entry.pending)
  try {
    getWorker().postMessage({ id, route: plainRoute })
  } catch (err) {
    console.error('[events-worker-client] postMessage threw', err)
    pending.delete(id)
    activeCount--
    entry.pending.reject(err)
    pumpQueue()
  }
}

function getWorker(): Worker {
  if (worker) return worker
  worker = new EventsWorker()
  worker.addEventListener('message', (e: MessageEvent<WorkerResponse>) => {
    const entry = pending.get(e.data.id)
    if (!entry) return
    pending.delete(e.data.id)
    activeCount--
    // A cancelled entry's caller no longer wants the result — swallow it so
    // we don't leak a rejection or emit stale data into the UI.
    if (!entry.cancelled) {
      if (e.data.error !== undefined) {
        entry.reject(new Error(e.data.error))
      } else {
        entry.resolve(e.data.timeline ?? [])
      }
    }
    pumpQueue()
  })
  worker.addEventListener('error', (e) => {
    console.error('[events-worker-client] worker error', e.message, e.filename, e.lineno)
    // Fatal worker error: reject everything in flight and force recreation
    // on the next call. Without this, pending promises hang forever.
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

export type TimelineEventsRequest = {
  promise: Promise<TimelineEvent[]>
  cancel: () => void
}

export function getTimelineEventsInWorker(route: Route): TimelineEventsRequest {
  const pendingEntry: PendingEntry = {
    resolve: () => {},
    reject: () => {},
    cancelled: false,
  }
  const promise = new Promise<TimelineEvent[]>((resolve, reject) => {
    pendingEntry.resolve = resolve
    pendingEntry.reject = reject
  })
  const queueEntry: QueueEntry = { route, pending: pendingEntry, cancelled: false }
  enqueue(queueEntry)
  pumpQueue()
  return {
    promise,
    // Idempotent. If the request is still in the waiting queue, pumpQueue
    // will skip it next time around; if it's already dispatched, the worker
    // response handler will see `cancelled` and drop the result.
    cancel: () => {
      if (queueEntry.cancelled) return
      queueEntry.cancelled = true
      pendingEntry.cancelled = true
      pendingEntry.reject(new CancelledError())
    },
  }
}
