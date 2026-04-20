/// <reference lib="webworker" />
import { cachedFetch } from './cache'
import type { Route } from './types'

type WorkerRequest = { id: number; route: Route }
type SpriteResult = {
  // Parallel to route segments (index i == segment i). `null` means the segment
  // sprite was missing, failed to fetch, or failed to decode — keep position so
  // downstream code can map segment index → sprite deterministically.
  segmentBlobs: (Blob | null)[]
  segmentTileCounts: number[]
  lastTileBlob: Blob | null
}
type WorkerResponse = { id: number; result?: SpriteResult; error?: string }

const TILE_WIDTH = 128
const TILE_HEIGHT = 80

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.addEventListener('message', (e: MessageEvent<WorkerRequest>) => {
  const { id, route } = e.data
  void fetchSprites(route)
    .then((result) => {
      const response: WorkerResponse = { id, result }
      ctx.postMessage(response)
    })
    .catch((err: unknown) => {
      const response: WorkerResponse = { id, error: err instanceof Error ? err.message : String(err) }
      ctx.postMessage(response)
    })
})

async function fetchSprites(route: Route): Promise<SpriteResult> {
  const urls = Array.from({ length: route.maxqlog + 1 }, (_, i) => `${route.url}/${i}/sprite.jpg`)
  const blobs = await Promise.all(urls.map(fetchBlob))

  const segmentBlobs: (Blob | null)[] = []
  const segmentTileCounts: number[] = []
  let lastBitmap: ImageBitmap | null = null

  for (const blob of blobs) {
    if (!blob) {
      segmentBlobs.push(null)
      segmentTileCounts.push(0)
      continue
    }
    try {
      const bitmap = await createImageBitmap(blob)
      const count = Math.round(bitmap.width / TILE_WIDTH)
      if (count > 0) {
        segmentBlobs.push(blob)
        segmentTileCounts.push(count)
        lastBitmap?.close()
        lastBitmap = bitmap
      } else {
        segmentBlobs.push(null)
        segmentTileCounts.push(0)
        bitmap.close()
      }
    } catch {
      segmentBlobs.push(null)
      segmentTileCounts.push(0)
    }
  }

  const lastTileBlob = lastBitmap ? await extractLastTile(lastBitmap) : null
  lastBitmap?.close()
  return { segmentBlobs, segmentTileCounts, lastTileBlob }
}

async function fetchBlob(url: string): Promise<Blob | null> {
  try {
    const res = await cachedFetch(url)
    if (!res.ok) return null
    return await res.blob()
  } catch {
    return null
  }
}

async function extractLastTile(bitmap: ImageBitmap): Promise<Blob | null> {
  try {
    const sourceX = Math.max(0, bitmap.width - TILE_WIDTH)
    const sourceW = Math.min(TILE_WIDTH, bitmap.width)
    const canvas = new OffscreenCanvas(TILE_WIDTH, TILE_HEIGHT)
    const c2d = canvas.getContext('2d')
    if (!c2d) return null
    c2d.drawImage(bitmap, sourceX, 0, sourceW, TILE_HEIGHT, 0, 0, TILE_WIDTH, TILE_HEIGHT)
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  } catch {
    return null
  }
}
