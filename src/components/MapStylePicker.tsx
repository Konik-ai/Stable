import { For, type VoidComponent } from 'solid-js'
import clsx from 'clsx'

import { mapStyleOptions, useMapStylePreference } from '~/map/preferences'
import type { MapStyleChoice } from '~/map'

type MapStylePickerProps = {
  class?: string
  onChange?: (value: MapStyleChoice) => void
}

const MapStylePicker: VoidComponent<MapStylePickerProps> = (props) => {
  const [mapStyle, setMapStyle] = useMapStylePreference()

  const handleChange = (value: MapStyleChoice) => {
    setMapStyle(value)
    props.onChange?.(value)
  }

  return (
    <label
      class={clsx(
        'flex items-center gap-2 rounded-md bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant shadow-[0_6px_12px_rgba(0,0,0,0.16)] shadow-inner backdrop-blur-sm',
        props.class,
      )}
    >
      <span class="whitespace-nowrap font-medium text-on-surface">Map style</span>
      <select
        class="rounded-lg bg-surface text-on-surface px-3 py-2 text-sm shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)] border border-outline/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
        value={mapStyle()}
        onChange={(e) => handleChange(e.currentTarget.value as MapStyleChoice)}
      >
        <For each={mapStyleOptions}>{(opt) => <option value={opt.key}>{opt.label}</option>}</For>
      </select>
    </label>
  )
}

export default MapStylePicker
