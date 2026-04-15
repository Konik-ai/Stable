/// <reference lib="webworker" />
import { getTimelineEvents, type TimelineEvent } from './derived'
import type { Route } from './types'

type WorkerRequest = { id: number; route: Route }
type WorkerResponse = { id: number; timeline?: TimelineEvent[]; error?: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.addEventListener('message', (e: MessageEvent<WorkerRequest>) => {
  const { id, route } = e.data
  getTimelineEvents(route)
    .then((timeline) => {
      const response: WorkerResponse = { id, timeline }
      ctx.postMessage(response)
    })
    .catch((err: unknown) => {
      const response: WorkerResponse = { id, error: err instanceof Error ? err.message : String(err) }
      ctx.postMessage(response)
    })
})
