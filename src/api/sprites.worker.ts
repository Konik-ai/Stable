/// <reference lib="webworker" />
import type { Route } from './types'

type WorkerRequest = { id: number; route: Route }
type SpriteResult = {
  segmentBlobs: Blob[]
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
  const results = await Promise.all(urls.map(fetchBlob))
  const segmentBlobs = results.filter((b): b is Blob => b !== null)
  if (segmentBlobs.length === 0) return { segmentBlobs: [], lastTileBlob: null }
  const lastTileBlob = await extractLastTile(segmentBlobs[segmentBlobs.length - 1])
  return { segmentBlobs, lastTileBlob }
}

async function fetchBlob(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.blob()
  } catch {
    return null
  }
}

async function extractLastTile(blob: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(blob)
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
