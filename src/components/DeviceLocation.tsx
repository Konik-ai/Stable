import { createEffect, createResource, createSignal, onMount, onCleanup, Show, type VoidComponent } from 'solid-js'
import { render } from 'solid-js/web'
import clsx from 'clsx'
import L from 'leaflet'

import Icon from './material/Icon'
import Button from './material/Button'

import { getDeviceLocation } from '~/api/devices'
import Card from '~/components/material/Card'
import type { IconName } from '~/components/material/Icon'
import IconButton from '~/components/material/IconButton'
import { getTileUrl } from '~/map'
import { useMapStylePreference } from '~/map/preferences'
import MapStylePicker from '~/components/MapStylePicker'
import { getFullAddress } from '~/map/geocode'
import { MAPBOX_TOKEN } from '~/map/config'
import { dayjs, formatDistance, formatDuration } from '~/utils/format'

type Location = {
  lat: number
  lng: number
  label: string
  address: string | null
}

const SAN_DIEGO: [number, number] = [32.711483, -117.161052]

type DeviceLocationProps = {
  dongleId: string
  deviceName: string
}

type DirectionsStep = {
  instruction: string
  distanceMeters: number
  durationSeconds: number
}

type DirectionsRoute = {
  distanceMeters: number
  durationSeconds: number
  coordinates: Array<[number, number]>
  steps: Array<DirectionsStep & { maneuverLocation: [number, number] }>
}

const DeviceLocation: VoidComponent<DeviceLocationProps> = (props) => {
  let mapRef!: HTMLDivElement
  let navMapRef!: HTMLDivElement

  const [map, setMap] = createSignal<L.Map | null>(null)
  const [navMap, setNavMap] = createSignal<L.Map | null>(null)
  const [mapStyle] = useMapStylePreference()
  const [selectedLocation, setSelectedLocation] = createSignal<Location | null>(null)
  const [showSelectedLocation, setShowSelectedLocation] = createSignal(false)
  const [userPosition, setUserPosition] = createSignal<GeolocationPosition | null>(null)
  const [directions, setDirections] = createSignal<DirectionsRoute | null>(null)
  const [directionsError, setDirectionsError] = createSignal<string | null>(null)
  const [directionsLoading, setDirectionsLoading] = createSignal(false)
  const [directionsVisible, setDirectionsVisible] = createSignal(false)
  const [navActive, setNavActive] = createSignal(false)
  const [currentStepIndex, setCurrentStepIndex] = createSignal(0)
  const [distanceToManeuver, setDistanceToManeuver] = createSignal<number | null>(null)
  const [deviceLocation] = createResource(
    () => props.dongleId,
    (dongleId) => getDeviceLocation(dongleId),
  )

  let tileLayer: L.TileLayer | null = null
  let navTileLayer: L.TileLayer | null = null
  let navRouteLayer: L.Polyline | null = null
  let navUserMarker: L.Marker | null = null
  let watchId: number | null = null

  onMount(() => {
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((permission) => {
        permission.addEventListener('change', requestUserLocation)

        if (permission.state === 'granted') {
          requestUserLocation()
        }
      })
      .catch(() => setUserPosition(null))

    const tileUrl = getTileUrl(mapStyle())
    tileLayer = L.tileLayer(tileUrl)

    const m = L.map(mapRef, {
      attributionControl: false,
      zoomControl: false,
      layers: [tileLayer],
    })
    m.setView(SAN_DIEGO, 10)
    m.on('click', () => setShowSelectedLocation(false))

    setMap(m)

    // fix: leaflet sometimes misses resize events
    // and leaves unrendered gray tiles
    const observer = new ResizeObserver(() => m.invalidateSize())
    observer.observe(mapRef)

    onCleanup(() => {
      observer.disconnect()
      m.remove()
    })
  })

  createEffect(() => {
    const styleKey = mapStyle()
    if (!tileLayer) return
    tileLayer.setUrl(getTileUrl(styleKey))
  })
  createEffect(() => {
    const styleKey = mapStyle()
    if (!navTileLayer) return
    navTileLayer.setUrl(getTileUrl(styleKey))
  })

  const [locationData] = createResource(
    () => ({
      map: map(),
      deviceName: props.deviceName,
      deviceLocation: deviceLocation(),
      userPosition: userPosition(),
    }),
    async (args) => {
      if (!args.map) {
        return []
      }

      const foundLocations: Location[] = []

      const location = deviceLocation()
      if (location) {
        const address = await getFullAddress([location.lng, location.lat])
        const deviceLoc: Location = {
          lat: location.lat,
          lng: location.lng,
          label: args.deviceName,
          address,
        }

        addMarker(args.map, deviceLoc, 'directions_car')
        foundLocations.push(deviceLoc)
      }

      if (args.userPosition) {
        const { longitude, latitude } = args.userPosition.coords
        const address = await getFullAddress([longitude, latitude])
        const userLoc: Location = {
          lat: latitude,
          lng: longitude,
          label: 'You',
          address,
        }

        addMarker(args.map, userLoc, 'person', 'bg-primary')
        foundLocations.push(userLoc)
      }

      if (foundLocations.length > 1) {
        args.map.fitBounds(L.latLngBounds(foundLocations.map((l) => [l.lat, l.lng])), { padding: [50, 50] })
      } else if (foundLocations.length === 1) {
        args.map.setView([foundLocations[0].lat, foundLocations[0].lng], 15)
      } else {
        throw new Error('Offline')
      }

      return foundLocations
    },
  )

  const addMarker = (instance: L.Map, loc: Location, iconName: IconName, iconClass?: string) => {
    const el = document.createElement('div')

    render(
      () => (
        <div class={clsx('flex size-[40px] items-center justify-center rounded-full bg-primary-container', iconClass)}>
          <Icon name={iconName} />
        </div>
      ),
      el,
    )

    const icon = L.divIcon({
      className: 'border-none bg-none',
      html: el.innerHTML,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    })

    L.marker([loc.lat, loc.lng], { icon })
      .addTo(instance)
      .on('click', () => {
        setSelectedLocation(loc)
        setShowSelectedLocation(true)
      })
  }

  const requestUserLocation = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserPosition(pos),
      (err) => {
        console.log("Error getting user's position", err)
        setUserPosition(null)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const resetTileLayer = () => {
    const instance = map()
    if (!instance || !tileLayer) return
    instance.removeLayer(tileLayer)
    tileLayer = L.tileLayer(getTileUrl(mapStyle()))
    tileLayer.addTo(instance)
  }

  const refreshMap = () => {
    const instance = map()
    if (!instance) return
    instance.invalidateSize()
    tileLayer?.redraw()
  }

  const fetchDirections = async (origin: [number, number], destination: [number, number]) => {
    if (!MAPBOX_TOKEN) {
      throw new Error('Mapbox token missing.')
    }
    const coords = `${origin[0]},${origin[1]};${destination[0]},${destination[1]}`
    const query = new URLSearchParams({
      access_token: MAPBOX_TOKEN,
      geometries: 'geojson',
      steps: 'true',
      overview: 'full',
    })
    const resp = await fetch(`https://api.mapbox.com/directions/v5/mapbox/walking/${coords}?${query.toString()}`)
    if (!resp.ok) {
      throw new Error(`Directions request failed: ${resp.status}`)
    }
    const data = await resp.json()
    const route = data?.routes?.[0]
    if (!route || !route.geometry?.coordinates) {
      throw new Error('No route found.')
    }
    const steps: Array<DirectionsStep & { maneuverLocation: [number, number] }> = (route.legs?.[0]?.steps ?? []).map((step: any) => ({
      instruction: step.maneuver?.instruction ?? 'Continue',
      distanceMeters: step.distance ?? 0,
      durationSeconds: step.duration ?? 0,
      maneuverLocation: step.maneuver?.location ?? destination,
    }))
    return {
      distanceMeters: route.distance ?? 0,
      durationSeconds: route.duration ?? 0,
      coordinates: route.geometry.coordinates as Array<[number, number]>,
      steps,
    } satisfies DirectionsRoute
  }

  const startVehicleFinder = async () => {
    const loc = deviceLocation()
    if (!loc) return
    setDirectionsError(null)
    setDirectionsLoading(true)
    setShowSelectedLocation(false)
    setNavActive(true)
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
      })
      setUserPosition(position)
      const origin: [number, number] = [position.coords.longitude, position.coords.latitude]
      const destination: [number, number] = [loc.lng, loc.lat]
      const route = await fetchDirections(origin, destination)
      setDirections(route)
      setDirectionsVisible(true)
      setCurrentStepIndex(0)
    } catch (err) {
      setDirectionsError(err instanceof Error ? err.message : 'Failed to load directions.')
      setDirectionsVisible(true)
      setDirections(null)
      setNavActive(false)
    } finally {
      setDirectionsLoading(false)
    }
  }

  const stopVehicleFinder = () => {
    setDirectionsVisible(false)
    setDirections(null)
    setDirectionsError(null)
    setDirectionsLoading(false)
    setNavActive(false)
    setCurrentStepIndex(0)
    setDistanceToManeuver(null)
    if (navRouteLayer && navMap()) {
      navMap()!.removeLayer(navRouteLayer)
      navRouteLayer = null
    }
    if (navUserMarker && navMap()) {
      navMap()!.removeLayer(navUserMarker)
      navUserMarker = null
    }
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId)
      watchId = null
    }
    if (navMap()) {
      navMap()!.remove()
      setNavMap(null)
      navTileLayer = null
    }
    resetTileLayer()
    requestAnimationFrame(refreshMap)
    setTimeout(refreshMap, 150)
  }

  createEffect(() => {
    if (!navActive()) {
      if (navMap()) {
        navMap()!.remove()
        setNavMap(null)
        navTileLayer = null
        navRouteLayer = null
        navUserMarker = null
      }
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId)
        watchId = null
      }
      return
    }
    if (navMap()) {
      requestAnimationFrame(() => navMap()!.invalidateSize())
      return
    }
    if (!navMapRef) return
    navTileLayer = L.tileLayer(getTileUrl(mapStyle()))
    const m = L.map(navMapRef, {
      attributionControl: false,
      zoomControl: false,
      layers: [navTileLayer],
    })
    const loc = deviceLocation()
    if (loc) {
      m.setView([loc.lat, loc.lng], 16)
    } else {
      m.setView(SAN_DIEGO, 10)
    }
    setNavMap(m)
    requestAnimationFrame(() => m.invalidateSize())
  })

  createEffect(() => {
    const route = directions()
    const instance = navMap()
    if (!instance) return
    if (!route) {
      if (navRouteLayer) {
        instance.removeLayer(navRouteLayer)
        navRouteLayer = null
      }
      return
    }
    if (navRouteLayer) {
      instance.removeLayer(navRouteLayer)
    }
    const latLngs = route.coordinates.map(([lng, lat]) => [lat, lng]) as [number, number][]
    navRouteLayer = L.polyline(latLngs, { color: '#0ea5e9', weight: 5, opacity: 0.9 })
    navRouteLayer.addTo(instance)
    const bounds = L.latLngBounds(latLngs)
    instance.fitBounds(bounds, { padding: [50, 80] })
  })

  const updateNavigation = (position: GeolocationPosition) => {
    const route = directions()
    const instance = navMap()
    if (!route || !instance) return

    const { latitude, longitude, heading } = position.coords
    const userLatLng = L.latLng(latitude, longitude)

    if (!navUserMarker) {
      const markerEl = document.createElement('div')
      render(
        () => (
          <div class="flex size-10 items-center justify-center rounded-full bg-primary shadow-lg">
            <Icon name="my_location" />
          </div>
        ),
        markerEl,
      )
      navUserMarker = L.marker([latitude, longitude], {
        icon: L.divIcon({
          className: 'border-none bg-none',
          html: markerEl.innerHTML,
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        }),
      }).addTo(instance)
    } else {
      navUserMarker.setLatLng([latitude, longitude])
    }

    if (typeof heading === 'number' && !Number.isNaN(heading)) {
      instance.setView([latitude, longitude], instance.getZoom(), { animate: false })
    } else {
      instance.setView([latitude, longitude], instance.getZoom(), { animate: false })
    }

    const idx = currentStepIndex()
    const step = route.steps[idx]
    if (!step) return
    const [stepLng, stepLat] = step.maneuverLocation
    const stepDistance = userLatLng.distanceTo(L.latLng(stepLat, stepLng))
    setDistanceToManeuver(stepDistance)
    if (stepDistance < 20 && idx < route.steps.length - 1) {
      setCurrentStepIndex(idx + 1)
    }
  }

  createEffect(() => {
    if (!navActive()) return
    if (watchId !== null) return
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setUserPosition(pos)
        updateNavigation(pos)
        if (directionsLoading()) setDirectionsLoading(false)
      },
      (err) => {
        const message = err?.message || 'Unable to track your location.'
        setDirectionsError(message)
        setDirectionsLoading(false)
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
    )
  })

  return (
    <div class="relative">
      <div ref={mapRef} class="h-[240px] w-full !bg-surface-container-low" />

      <Show when={!navActive()}>
        <div class="absolute left-2 top-2 z-[9999]">
          <MapStylePicker />
        </div>
      </Show>

      <Show when={!navActive() && !userPosition() && !showSelectedLocation()}>
        <div class="absolute bottom-2 right-2 z-[9999]">
          <Button
            title="Show your current location"
            color="secondary"
            class="bg-surface-container-low text-on-surface-variant"
            onClick={() => void requestUserLocation()}
            leading={<Icon name="my_location" size="20" />}
          >
            Show my location
          </Button>
        </div>
      </Show>

      <Show when={!navActive() && deviceLocation() && !showSelectedLocation()}>
        <div class="absolute bottom-2 left-2 z-[9999]">
          <Button
            color="secondary"
            onClick={directionsVisible() ? stopVehicleFinder : startVehicleFinder}
            leading={<Icon name="directions_car" size="20" />}
            loading={directionsLoading()}
          >
            {directionsVisible() ? 'End guidance' : 'Guide me to my car'}
          </Button>
        </div>
      </Show>

      <Show when={!navActive() && locationData.loading}>
        <div class="absolute left-1/2 top-1/2 z-[5000] flex -translate-x-1/2 -translate-y-1/2 items-center rounded-full bg-surface-variant px-4 py-2 shadow">
          <div class="mr-2 size-4 animate-spin rounded-full border-2 border-on-surface-variant border-t-transparent" />
          <span class="text-sm">Locating...</span>
        </div>
      </Show>

      <Show when={!navActive() && (locationData.error as Error)?.message}>
        <div class="absolute left-1/2 top-1/2 z-[5000] flex -translate-x-1/2 -translate-y-1/2 items-center rounded-full bg-surface-variant px-4 py-2 shadow">
          <Icon class="mr-2" name="error" size="20" />
          <span class="text-sm">{(locationData.error as Error).message}</span>
        </div>
      </Show>

      <Show when={navActive()}>
        <div class="fixed inset-0 z-[10000] bg-background">
          <div ref={navMapRef} class="h-full w-full !bg-surface-container-low" />

          <div class="absolute left-1/2 top-4 z-[10001] w-[min(720px,92%)] -translate-x-1/2 rounded-[32px] border border-transparent bg-surface-container-high px-4 py-3 text-on-surface shadow-xl ring-0">
            <div class="flex items-center justify-between gap-4">
              <div class="flex items-center gap-3">
                <div class="flex size-11 items-center justify-center rounded-full bg-primary-container text-on-primary-container">
                  <Icon name="keyboard_arrow_up" size="24" class="rotate-90" />
                </div>
                <div class="flex flex-col">
                  <span class="text-xs uppercase tracking-wide text-on-surface-variant">Next</span>
                  <span class="text-lg font-semibold text-on-surface">
                    {directions()?.steps[currentStepIndex()]?.instruction ?? 'Follow the route'}
                  </span>
                  <span class="text-sm text-on-surface-variant">{formatDistance((distanceToManeuver() ?? 0) / 1609.344) ?? '...'}</span>
                </div>
              </div>
              <IconButton name="close" onClick={stopVehicleFinder} class="text-on-surface-variant" />
            </div>
          </div>

          <div class="absolute bottom-6 left-1/2 z-[10001] w-[min(720px,92%)] -translate-x-1/2 rounded-[32px] border border-transparent bg-surface-container-high px-6 py-4 text-on-surface shadow-2xl ring-0">
            <div class="flex items-center justify-between gap-6">
              <div class="flex flex-col">
                <span class="text-xs uppercase tracking-wide text-on-surface-variant">Eta</span>
                <span class="text-2xl font-semibold text-on-surface">{formatDuration((directions()?.durationSeconds ?? 0) / 60)}</span>
                <span class="text-sm text-on-surface-variant">
                  {formatDistance((directions()?.distanceMeters ?? 0) / 1609.344)} ·{' '}
                  {dayjs()
                    .add(directions()?.durationSeconds ?? 0, 'second')
                    .format('h:mm A')}
                </span>
              </div>
              <Button color="secondary" onClick={stopVehicleFinder} class="rounded-full">
                Exit
              </Button>
            </div>
          </div>

          <Show when={directionsError()}>
            <div class="absolute left-1/2 top-24 z-[10001] -translate-x-1/2 rounded-full bg-surface-container-high px-4 py-2 text-sm text-error shadow">
              {directionsError()}
            </div>
          </Show>
        </div>
      </Show>

      <Card
        class={clsx(
          'absolute inset-x-2 bottom-2 z-[9999] flex !bg-surface-container-high p-4 pt-3 transition-opacity duration-150',
          showSelectedLocation() && !directionsVisible() && !navActive() ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <div class="mb-2 flex flex-row items-center justify-between gap-4">
          <span class="truncate text-md">{selectedLocation()?.label}</span>
          <IconButton name="close" onClick={() => setShowSelectedLocation(false)} />
        </div>
        <div class="flex flex-col items-end gap-3 xs:flex-row">
          <span class="text-sm text-on-surface-variant">{selectedLocation()?.address}</span>
          <Button
            color="secondary"
            onClick={() => window.open(`https://www.google.com/maps?q=${selectedLocation()!.lat},${selectedLocation()!.lng}`, '_blank')}
            trailing={<Icon name="open_in_new" size="20" />}
          >
            Open in Maps
          </Button>
        </div>
      </Card>
    </div>
  )
}

export default DeviceLocation
