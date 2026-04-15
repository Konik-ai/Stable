import EventsWorker from './events.worker?worker'
import type { TimelineEvent } from './derived'
import type { Route } from './types'

type WorkerResponse = { id: number; timeline?: TimelineEvent[]; error?: string }

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (r: TimelineEvent[]) => void; reject: (e: unknown) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new EventsWorker()
  worker.addEventListener('message', (e: MessageEvent<WorkerResponse>) => {
    const entry = pending.get(e.data.id)
    if (!entry) return
    pending.delete(e.data.id)
    if (e.data.error !== undefined) {
      entry.reject(new Error(e.data.error))
    } else {
      entry.resolve(e.data.timeline ?? [])
    }
  })
  worker.addEventListener('error', (e) => {
    console.error('[events-worker-client] worker error', e.message, e.filename, e.lineno)
    // Fatal worker error: reject everything in flight and force recreation
    // on the next call. Without this, pending promises hang forever.
    const err = new Error(e.message || 'worker crashed')
    for (const entry of pending.values()) entry.reject(err)
    pending.clear()
    worker?.terminate()
    worker = null
  })
  return worker
}

export function getTimelineEventsInWorker(route: Route): Promise<TimelineEvent[]> {
  const id = nextId++
  // The route comes from tanstack solid-query as a Solid store proxy, which
  // postMessage's structured clone can't serialize. JSON round-trip gives us
  // a plain object — Route is all primitives + primitive arrays, so this is lossless.
  const plainRoute = JSON.parse(JSON.stringify(route)) as Route
  return new Promise<TimelineEvent[]>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    try {
      getWorker().postMessage({ id, route: plainRoute })
    } catch (err) {
      console.error('[events-worker-client] postMessage threw', err)
      pending.delete(id)
      reject(err)
    }
  })
}
