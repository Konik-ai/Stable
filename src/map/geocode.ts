import type { Position } from 'geojson'
import * as Sentry from '@sentry/browser'

import type { ForwardGeocodingFeature, ForwardGeocodingResponse, ReverseGeocodingResponse, ReverseGeocodingFeature } from '~/map/api-types'
import { getMapboxToken, primeMapboxToken } from '~/map/config'

export async function reverseGeocode(position: Position): Promise<ReverseGeocodingFeature | null> {
  if (Math.abs(position[0]) < 0.001 && Math.abs(position[1]) < 0.001) {
    return null
  }
  const token = getMapboxToken() || (await primeMapboxToken())
  if (!token) {
    return null
  }
  const query = new URLSearchParams({
    longitude: position[0].toFixed(6),
    latitude: position[1].toFixed(6),
    access_token: token,
  })
  let resp: Response
  try {
    resp = await fetch(`https://api.mapbox.com/search/geocode/v6/reverse?${query.toString()}`, { cache: 'force-cache' })
  } catch (error) {
    console.error('[geocode] Reverse geocode lookup failed', error)
    return null
  }
  if (!resp.ok) {
    Sentry.captureException(new Error(`Reverse geocode lookup failed: ${resp.status} ${resp.statusText}`))
    return null
  }
  try {
    const collection = (await resp.json()) as ReverseGeocodingResponse
    return collection?.features?.[0] ?? null
  } catch (error) {
    Sentry.captureException(new Error('Could not parse reverse geocode response', { cause: error }))
    return null
  }
}

export async function forwardGeocode(queryText: string, limit: number = 6): Promise<ForwardGeocodingFeature[]> {
  const q = queryText.trim()
  if (q.length < 2) {
    return []
  }

  const token = getMapboxToken() || (await primeMapboxToken())
  if (!token) {
    return []
  }

  const query = new URLSearchParams({
    q,
    access_token: token,
    autocomplete: 'true',
    limit: String(limit),
  })

  let resp: Response
  try {
    resp = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${query.toString()}`)
  } catch (error) {
    console.error('[geocode] Forward geocode lookup failed', error)
    return []
  }

  if (!resp.ok) {
    Sentry.captureException(new Error(`Forward geocode lookup failed: ${resp.status} ${resp.statusText}`))
    return []
  }

  try {
    const collection = (await resp.json()) as ForwardGeocodingResponse
    return collection?.features ?? []
  } catch (error) {
    Sentry.captureException(new Error('Could not parse forward geocode response', { cause: error }))
    return []
  }
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
