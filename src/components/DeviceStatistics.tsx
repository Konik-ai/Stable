import { createResource } from 'solid-js'
import type { VoidComponent } from 'solid-js'

import { getDeviceStats } from '~/api/devices'
import { formatDistance, formatDuration } from '~/utils/format'
import StatisticBar from './StatisticBar'

const DeviceStatistics: VoidComponent<{ class?: string; dongleId: string }> = (props) => {
  const [statistics] = createResource(() => props.dongleId, getDeviceStats)
  const allTime = () => statistics()?.all

  const lifetimeDistanceMi = () => {
    const st = allTime()
    return st?.statsDistanceTraveled ?? st?.distance ?? st?.length
  }

  return (
    <StatisticBar
      class={props.class}
      statistics={[
        { label: 'Distance', value: () => formatDistance(lifetimeDistanceMi()) },
        { label: 'Duration', value: () => formatDuration(allTime()?.minutes) },
        { label: 'Routes', value: () => allTime()?.routes },
      ]}
    />
  )
}

export default DeviceStatistics
