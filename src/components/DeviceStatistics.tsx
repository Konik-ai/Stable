import { createResource, createSignal, onCleanup } from 'solid-js'
import type { VoidComponent } from 'solid-js'

import { getPeripheralState } from '~/api/athena'
import { getDevice, getDeviceStats } from '~/api/devices'
import { formatDistance, formatDuration } from '~/utils/format'
import StatisticBar from './StatisticBar'

const VOLTAGE_POLL_MS = 30_000

const DeviceStatistics: VoidComponent<{ class?: string; dongleId: string }> = (props) => {
  const [statistics] = createResource(() => props.dongleId, getDeviceStats)
  const [device] = createResource(() => props.dongleId, getDevice)
  const allTime = () => statistics()?.all

  const lifetimeDistanceMi = () => {
    const st = allTime()
    return st?.statsDistanceTraveled ?? st?.distance ?? st?.length
  }

  const [voltageTick, setVoltageTick] = createSignal(0)
  const [peripheralState] = createResource(
    () => {
      voltageTick()
      return device()?.is_online ? props.dongleId : undefined
    },
    (dongleId) => getPeripheralState(dongleId),
  )

  const timer = setInterval(() => {
    if (device()?.is_online) setVoltageTick((n) => n + 1)
  }, VOLTAGE_POLL_MS)
  onCleanup(() => clearInterval(timer))

  const batteryVoltage = () => {
    const state = peripheralState()
    if (!state?.result?.peripheralState?.voltage) return undefined
    return (state.result.peripheralState.voltage / 1000.0).toFixed(1)
  }

  const batteryLabel = () => {
    if (!device()?.is_online) return 'Offline'
    const v = batteryVoltage()
    if (v === undefined) return '—'
    return `${v} V`
  }

  return (
    <StatisticBar
      class={props.class}
      statistics={[
        { label: 'Distance', value: () => formatDistance(lifetimeDistanceMi()) },
        { label: 'Duration', value: () => formatDuration(allTime()?.minutes) },
        { label: 'Routes', value: () => allTime()?.routes },
        { label: 'Battery', value: () => batteryLabel() },
      ]}
    />
  )
}

export default DeviceStatistics
