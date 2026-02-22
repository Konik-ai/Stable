import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, type VoidComponent } from 'solid-js'

import { setDestination } from '~/api/navigation'
import type { ForwardGeocodingFeature } from '~/map/api-types'
import { forwardGeocode } from '~/map/geocode'
import Button from '~/components/material/Button'
import Icon from '~/components/material/Icon'
import TextField from '~/components/material/TextField'

type DeviceDestinationProps = {
  dongleId: string
}

type DestinationOption = {
  latitude: number
  longitude: number
  placeName: string
  placeDetails: string
}

const toDestinationOption = (feature: ForwardGeocodingFeature): DestinationOption | null => {
  const [longitude, latitude] = feature.geometry.coordinates
  if (typeof longitude !== 'number' || typeof latitude !== 'number') return null

  const placeName = feature.properties.name || feature.properties.full_address || feature.properties.place_formatted || ''
  if (!placeName) return null

  return {
    latitude,
    longitude,
    placeName,
    placeDetails: feature.properties.full_address || feature.properties.place_formatted || placeName,
  }
}

const DeviceDestination: VoidComponent<DeviceDestinationProps> = (props) => {
  const [query, setQuery] = createSignal('')
  const [debouncedQuery, setDebouncedQuery] = createSignal('')
  const [selected, setSelected] = createSignal<DestinationOption | null>(null)
  const [sending, setSending] = createSignal(false)
  const [status, setStatus] = createSignal<string | undefined>(undefined)
  const [error, setError] = createSignal<string | undefined>(undefined)

  createEffect(() => {
    const value = query().trim()
    const timer = window.setTimeout(() => setDebouncedQuery(value), 250)
    onCleanup(() => window.clearTimeout(timer))
  })

  const [searchResults] = createResource(
    debouncedQuery,
    async (value) => {
      if (value.length < 2) return [] as ForwardGeocodingFeature[]
      return forwardGeocode(value, 6)
    },
    { initialValue: [] as ForwardGeocodingFeature[] },
  )

  const options = createMemo<DestinationOption[]>(() =>
    searchResults()
      .map(toDestinationOption)
      .filter((item): item is DestinationOption => item !== null),
  )

  const clearState = () => {
    setSelected(null)
    setStatus(undefined)
    setError(undefined)
  }

  const clearAll = () => {
    setQuery('')
    setDebouncedQuery('')
    clearState()
  }

  const selectOption = (option: DestinationOption) => {
    setSelected(option)
    setQuery(option.placeName)
    setStatus(undefined)
    setError(undefined)
  }

  const sendDestination = async () => {
    if (sending()) return

    const destination = selected()
    if (!destination) {
      setError('Select a destination from the results list before sending.')
      setStatus(undefined)
      return
    }

    setSending(true)
    setStatus(undefined)
    setError(undefined)

    try {
      const resp = await setDestination(props.dongleId, {
        latitude: destination.latitude,
        longitude: destination.longitude,
        place_name: destination.placeName,
        place_details: destination.placeDetails,
      })

      setStatus(resp.saved_next ? 'Device offline. Destination queued.' : 'Destination sent to your device.')
    } catch (err) {
      setError((err as Error).message || 'Failed to send destination')
    } finally {
      setSending(false)
    }
  }

  return (
    <div class="flex flex-col gap-2 border-t border-outline-variant/20 p-4">
      <h3 class="text-md font-bold">Navigation</h3>
      <TextField
        label="Destination"
        value={query()}
        helperText="Search a place, then send it to your device"
        onInput={(e) => {
          setQuery(e.currentTarget.value)
          setSelected(null)
          setStatus(undefined)
          setError(undefined)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void sendDestination()
          }
        }}
      />

      <Show when={!selected() && debouncedQuery().length >= 2}>
        <div class="rounded-sm bg-surface-container-highest">
          <Show when={searchResults.loading}>
            <div class="p-3 text-sm text-on-surface-variant">Searching...</div>
          </Show>
          <Show when={!searchResults.loading && options().length === 0}>
            <div class="p-3 text-sm text-on-surface-variant">No matches found.</div>
          </Show>
          <Show when={options().length > 0}>
            <div class="max-h-48 overflow-y-auto">
              <For each={options()}>
                {(option) => (
                  <button
                    class="flex w-full flex-col gap-1 border-b border-outline-variant/10 px-3 py-2 text-left last:border-b-0 hover:bg-on-surface/5"
                    type="button"
                    onClick={() => selectOption(option)}
                  >
                    <span class="text-sm font-medium">{option.placeName}</span>
                    <span class="text-xs text-on-surface-variant">{option.placeDetails}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      <div class="mt-1 flex items-center gap-2">
        <Button leading={<Icon name="flag" size="20" />} onClick={() => void sendDestination()} loading={sending()} disabled={!selected()}>
          Send to device
        </Button>
        <Button color="text" onClick={clearAll} disabled={sending()}>
          Clear
        </Button>
      </div>

      <Show when={status()}>
        <div class="flex items-center gap-2 rounded-sm bg-surface-container-high p-2 text-sm text-on-surface">
          <Icon class="text-primary" name="check" size="20" />
          <span>{status()}</span>
        </div>
      </Show>

      <Show when={error()}>
        <div class="flex items-center gap-2 rounded-sm bg-surface-container-high p-2 text-sm text-on-surface">
          <Icon class="text-error" name="error" size="20" />
          <span>{error()}</span>
        </div>
      </Show>
    </div>
  )
}

export default DeviceDestination
