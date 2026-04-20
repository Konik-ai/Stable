const CACHE_NAME = 'konik-route-data-v1'

async function openCache(): Promise<Cache | null> {
  try {
    return await caches.open(CACHE_NAME)
  } catch {
    return null
  }
}

// Route-derived files (events.json, coords.json, sprite.jpg) are immutable
// per URL — once uploaded, segment data never changes. Cache-first on 2xx
// responses; fall back to plain fetch if the Cache API is unavailable
// (non-secure contexts) or throws.
export async function cachedFetch(url: string): Promise<Response> {
  const cache = await openCache()
  if (cache) {
    const hit = await cache.match(url).catch(() => undefined)
    if (hit) return hit
  }
  const response = await fetch(url)
  if (cache && response.ok) {
    void cache.put(url, response.clone()).catch(() => {})
  }
  return response
}
