export const MAPBOX_USERNAME = 'commaai'

export const MAPBOX_LIGHT_STYLE_ID = 'clcl7mnu2000214s2zgcdly6e'
export const MAPBOX_DARK_STYLE_ID = 'clcgvbi4f000q15t6o2s8gys3'
export const MAPBOX_SATELLITE_STYLE_ID = 'satellite-streets-v12'

export type BaseMapStyleKey = 'light' | 'dark' | 'satellite'

export type MapStyleOption = {
  key: BaseMapStyleKey
  label: string
  owner: string
  id: string
}

export const MAP_STYLE_OPTIONS: MapStyleOption[] = [
  { key: 'light', label: 'Light', owner: MAPBOX_USERNAME, id: MAPBOX_LIGHT_STYLE_ID },
  { key: 'dark', label: 'Dark', owner: MAPBOX_USERNAME, id: MAPBOX_DARK_STYLE_ID },
  { key: 'satellite', label: 'Satellite', owner: 'mapbox', id: MAPBOX_SATELLITE_STYLE_ID },
]

type GistResponse = { files?: Record<string, { content?: string }> }

const MAPBOX_TOKEN_STORAGE_KEY = 'mapbox.token'
const MAPBOX_TOKEN_ETAG_STORAGE_KEY = 'mapbox.token.etag'
const MAPBOX_TOKEN_GIST_API =
  (import.meta.env.VITE_MAPBOX_TOKEN_GIST_API as string | undefined) || 'https://api.github.com/gists/115caba1efdffe0b6d0d6dfcabf709ff'
const MAPBOX_TOKEN_GIST_FILE = (import.meta.env.VITE_MAPBOX_TOKEN_GIST_FILE as string | undefined) || 'mapbox.token'
const MAPBOX_TOKEN_FETCH_TIMEOUT_MS = Number(import.meta.env.VITE_MAPBOX_TOKEN_FETCH_TIMEOUT_MS || 3000)
const MAPBOX_TOKEN_REFRESH_INTERVAL_MS = Number(import.meta.env.VITE_MAPBOX_TOKEN_REFRESH_INTERVAL_MS || 300000)

const isMapboxToken = (token: string | null | undefined): token is string => {
  const trimmed = token?.trim()
  return !!trimmed && trimmed.startsWith('pk.') && trimmed.length >= 32
}

const readStorage = (key: string): string => {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

const writeStorage = (key: string, value: string): void => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // best effort cache only
  }
}

const readCachedToken = (): string => {
  const token = readStorage(MAPBOX_TOKEN_STORAGE_KEY)
  return isMapboxToken(token) ? token.trim() : ''
}

const extractTokenFromGist = (data: GistResponse): string => {
  const files = data.files || {}
  const token = (files[MAPBOX_TOKEN_GIST_FILE]?.content || Object.values(files)[0]?.content || '').trim()
  return isMapboxToken(token) ? token : ''
}

let mapboxToken = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined)?.trim() || readCachedToken()
let mapboxTokenEtag = readStorage(MAPBOX_TOKEN_ETAG_STORAGE_KEY)
let mapboxTokenLoad: Promise<string> | null = null
let mapboxTokenRefreshTimer: number | null = null

export function getMapboxToken(): string {
  return mapboxToken
}

export async function primeMapboxToken(forceRefresh: boolean = false): Promise<string> {
  if (!forceRefresh && isMapboxToken(mapboxToken)) return mapboxToken
  if (mapboxTokenLoad) return mapboxTokenLoad

  mapboxTokenLoad = (async () => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), MAPBOX_TOKEN_FETCH_TIMEOUT_MS)

    try {
      const headers: Record<string, string> = {}
      if (mapboxTokenEtag) headers['If-None-Match'] = mapboxTokenEtag

      const response = await fetch(MAPBOX_TOKEN_GIST_API, {
        cache: 'no-store',
        signal: controller.signal,
        headers,
      })

      if (response.status === 304 || !response.ok) return mapboxToken

      const etag = response.headers.get('etag')
      if (etag) {
        mapboxTokenEtag = etag
        writeStorage(MAPBOX_TOKEN_ETAG_STORAGE_KEY, etag)
      }

      const token = extractTokenFromGist((await response.json()) as GistResponse)
      if (!token || token === mapboxToken) return mapboxToken

      mapboxToken = token
      writeStorage(MAPBOX_TOKEN_STORAGE_KEY, token)
      return mapboxToken
    } catch (error) {
      console.error('[mapbox] Failed to load token from gist', error)
      return mapboxToken
    } finally {
      clearTimeout(timeoutId)
      mapboxTokenLoad = null
    }
  })()

  return mapboxTokenLoad
}

export function startMapboxTokenRefresh(): void {
  if (typeof window === 'undefined' || mapboxTokenRefreshTimer !== null || MAPBOX_TOKEN_REFRESH_INTERVAL_MS <= 0) return
  mapboxTokenRefreshTimer = window.setInterval(() => void primeMapboxToken(true), MAPBOX_TOKEN_REFRESH_INTERVAL_MS)
}
