import type { VoidComponent } from 'solid-js'

import type { RouteStatistics } from '~/api/derived'
import type { Route } from '~/api/types'
import { formatDistance, formatDuration, formatRouteDuration } from '~/utils/format'
import StatisticBar from './StatisticBar'

const RouteStatisticsBar: VoidComponent<{ class?: string; route: Route | undefined; statistics: RouteStatistics | undefined }> = (
  props,
) => {
  return (
    <StatisticBar
      class={props.class}
      statistics={[
        { label: 'Distance', value: () => formatDistance(props.route?.length) },
        {
          label: 'Duration',
          value: () =>
            props.statistics ? formatDuration(props.statistics.routeDurationMs / (60 * 1000)) : formatRouteDuration(props.route),
        },
      ]}
    />
  )
}

export default RouteStatisticsBar
