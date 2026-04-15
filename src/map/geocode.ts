import type { Position } from 'geojson'
import * as Sentry from '@sentry/browser'

import type { ReverseGeocodingResponse, ReverseGeocodingFeature } from '~/map/api-types'
import { MAPBOX_TOKEN } from '~/map/config'

// Mapbox v6 batch endpoint caps at 50 queries per request on the standard plan.
const BATCH_MAX = 50
// Microtask-scale wait: callers that enqueue in the same tick (e.g. a page
// prefetch iterating over N routes) coalesce into one POST.
const BATCH_DEBOUNCE_MS = 0
// 6dp ~= 10cm accuracy. Matches the precision we send to the API.
const COORD_PRECISION = 6

type PendingRequest = {
  longitude: number
  latitude: number
  resolve: (feature: ReverseGeocodingFeature | null) => void
  reject: (err: unknown) => void
}

const cache = new Map<string, Promise<ReverseGeocodingFeature | null>>()
let queue: PendingRequest[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function cacheKey(longitude: number, latitude: number): string {
  return `${longitude.toFixed(COORD_PRECISION)},${latitude.toFixed(COORD_PRECISION)}`
}

function scheduleFlush() {
  if (queue.length >= BATCH_MAX) {
    void flushQueue()
    return
  }
  if (flushTimer !== null) return
  flushTimer = setTimeout(flushQueue, BATCH_DEBOUNCE_MS)
}

async function flushQueue() {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (queue.length === 0) return

  const batch = queue.splice(0, BATCH_MAX)
  if (queue.length > 0) scheduleFlush()

  const body = batch.map((req) => ({
    longitude: req.longitude,
    latitude: req.latitude,
  }))

  let resp: Response
  try {
    resp = await fetch(`https://api.mapbox.com/search/geocode/v6/batch?access_token=${MAPBOX_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (error) {
    console.error('[geocode] Batch reverse geocode request failed', error)
    for (const req of batch) req.reject(error)
    return
  }

  if (!resp.ok) {
    const err = new Error(`Batch reverse geocode failed: ${resp.status} ${resp.statusText}`)
    Sentry.captureException(err)
    for (const req of batch) req.reject(err)
    return
  }

  let json: { batch?: ReverseGeocodingResponse[] }
  try {
    json = await resp.json()
  } catch (error) {
    Sentry.captureException(new Error('Could not parse batch reverse geocode response', { cause: error }))
    for (const req of batch) req.reject(error)
    return
  }

  const results = json.batch ?? []
  for (let i = 0; i < batch.length; i++) {
    batch[i].resolve(results[i]?.features?.[0] ?? null)
  }
}

export async function reverseGeocode(position: Position): Promise<ReverseGeocodingFeature | null> {
  if (Math.abs(position[0]) < 0.001 && Math.abs(position[1]) < 0.001) {
    return null
  }

  const longitude = Number(position[0].toFixed(COORD_PRECISION))
  const latitude = Number(position[1].toFixed(COORD_PRECISION))
  const key = cacheKey(longitude, latitude)

  const cached = cache.get(key)
  if (cached) return cached

  const promise = new Promise<ReverseGeocodingFeature | null>((resolve, reject) => {
    queue.push({ longitude, latitude, resolve, reject })
    scheduleFlush()
  })

  const wrapped = promise.catch(() => {
    cache.delete(key)
    return null
  })
  cache.set(key, wrapped)
  return wrapped
}

export async function getFullAddress(position: Position): Promise<string | null> {
  const feature = await reverseGeocode(position)
  if (!feature) return null
  return feature.properties.full_address
}

export async function getPlaceName(position: Position): Promise<string | null> {
  const feature = await reverseGeocode(position)
  if (!feature) return null
  const {
    properties: { context },
  } = feature
  return (
    [
      context.neighborhood?.name,
      context.place?.name,
      context.locality?.name,
      context.district?.name,
      context.region?.name,
      context.country?.name,
    ].find(Boolean) || ''
  )
}
