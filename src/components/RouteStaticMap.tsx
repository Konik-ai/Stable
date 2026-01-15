import { createResource, Match, Switch } from 'solid-js'
import type { JSXElement, VoidComponent } from 'solid-js'
import clsx from 'clsx'

import { type GPSPathPoint, getCoords } from '~/api/derived'
import { type Coords, type MapStyleChoice, getPathStaticMapUrl } from '~/map'
import { getCurrentMapStyleChoice, useMapStylePreference } from '~/map/preferences'
import { getThemeId } from '~/theme'
import type { Route } from '~/api/types'

import Icon from '~/components/material/Icon'
import MapStylePicker from '~/components/MapStylePicker'

const loadImage = (url: string | undefined): Promise<string | undefined> => {
  if (!url) {
    return Promise.resolve(undefined)
  }
  return new Promise<string>((resolve, reject) => {
    const image = new Image()
    image.src = url
    image.onload = () => resolve(url)
    image.onerror = (error) => reject(new Error('Failed to load image', { cause: error }))
  })
}

const getStaticMapUrl = (gpsPoints: GPSPathPoint[], styleKey: MapStyleChoice): string | undefined => {
  if (gpsPoints.length === 0) {
    return undefined
  }
  const path: Coords = []
  gpsPoints.forEach(({ lng, lat }) => {
    path.push([lng, lat])
  })
  const themeId = getThemeId()
  return getPathStaticMapUrl(themeId, path, 512, 512, true, styleKey)
}

const State = (props: { children: JSXElement; trailing?: JSXElement; opaque?: boolean }) => {
  return (
    <div class={clsx('absolute flex size-full items-center justify-center gap-2', props.opaque && 'bg-surface text-on-surface')}>
      <span class="text-xs">{props.children}</span>
      {props.trailing}
    </div>
  )
}

type RouteStaticMapProps = {
  class?: string
  route: Route | undefined
}

const RouteStaticMap: VoidComponent<RouteStaticMapProps> = (props) => {
  const [coords] = createResource(() => props.route, getCoords)
  const [mapStyle, setMapStyle] = useMapStylePreference()
  const [url] = createResource(
    () => [coords(), mapStyle()] as const,
    ([pts, style]) => getStaticMapUrl(pts ?? [], style ?? getCurrentMapStyleChoice()),
  )
  const [loadedUrl] = createResource(url, loadImage)

  return (
    <div class={clsx('relative isolate flex h-full flex-col justify-end self-stretch bg-surface text-on-surface', props.class)}>
      <div class="absolute right-2 top-2 z-10">
        <MapStylePicker onChange={setMapStyle} />
      </div>
      <Switch>
        <Match when={!!coords.error || !!url.error || !!loadedUrl.error} keyed>
          <State trailing={<Icon name="error" filled />}>Problem loading map</State>
        </Match>
        <Match when={coords()?.length === 0} keyed>
          <State trailing={<Icon name="satellite_alt" filled />}>No GPS data</State>
        </Match>
        <Match when={url() && loadedUrl()} keyed>
          <img class="pointer-events-none size-full object-cover" src={loadedUrl()} alt="" />
        </Match>
      </Switch>
    </div>
  )
}

export default RouteStaticMap
