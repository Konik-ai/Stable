import polyline from '@mapbox/polyline'

import { MAP_STYLE_OPTIONS, getMapboxToken, primeMapboxToken, type BaseMapStyleKey, type MapStyleOption } from './config'
import { getThemeId } from '~/theme'

export type Coords = [number, number][]
export type MapStyleChoice = BaseMapStyleKey | 'theme'

const POLYLINE_SAMPLE_SIZE = 50
const POLYLINE_PRECISION = 4

function resolveStyle(themeId: string, styleKey?: MapStyleChoice): MapStyleOption {
  const normalizedKey: BaseMapStyleKey = (() => {
    if (!styleKey || styleKey === 'theme') return themeId === 'light' ? 'light' : 'dark'
    return styleKey
  })()

  return MAP_STYLE_OPTIONS.find((s) => s.key === normalizedKey) || MAP_STYLE_OPTIONS.find((s) => s.key === 'light') || MAP_STYLE_OPTIONS[0]
}

function prepareCoords(coords: Coords, sampleSize: number): Coords {
  const sample = []
  const step = Math.max(Math.floor(coords.length / sampleSize), 1)
  for (let i = 0; i < coords.length; i += step) {
    const point = coords[i]
    // 1. mapbox uses lng,lat order
    // 2. polyline output is off by 10x when precision is 4
    sample.push([point[1] * 10, point[0] * 10] as [number, number])
  }
  return sample
}

// TODO: get path colour from theme
export function getPathStaticMapUrl(
  themeId: string,
  coords: Coords,
  width: number,
  height: number,
  hidpi: boolean,
  styleKey?: MapStyleChoice,
  strokeWidth: number = 4,
  color: string = 'DFE0FF',
  opacity: number = 1,
): string {
  const style = resolveStyle(themeId, styleKey)
  const token = getMapboxToken()
  if (!token) {
    void primeMapboxToken()
  }
  const hidpiStr = hidpi ? '@2x' : ''
  const encodedPolyline = polyline.encode(prepareCoords(coords, POLYLINE_SAMPLE_SIZE), POLYLINE_PRECISION)
  const path = `path-${strokeWidth}+${color}-${opacity}(${encodeURIComponent(encodedPolyline)})`
  return `https://api.mapbox.com/styles/v1/${style.owner}/${style.id}/static/${path}/auto/${width}x${height}${hidpiStr}?logo=false&attribution=false&padding=30,30,30,30&access_token=${token}`
}

export function getTileUrl(styleKey?: MapStyleChoice): string {
  const themeId = getThemeId()
  const style = resolveStyle(themeId, styleKey)
  const token = getMapboxToken()
  if (!token) {
    void primeMapboxToken()
  }

  return `https://api.mapbox.com/styles/v1/${style.owner}/${style.id}/tiles/256/{z}/{x}/{y}@2x?access_token=${token}`
}
