import type { Resource, VoidComponent } from 'solid-js'

import type { RouteStatistics } from '~/api/derived'
import type { Route } from '~/api/types'
import { formatDistance, formatDuration, formatRouteDuration } from '~/utils/format'
import StatisticBar from './StatisticBar'

const RouteStatisticsBar: VoidComponent<{ class?: string; route: Route | undefined; statistics: Resource<RouteStatistics> }> = (props) => {
  return (
    <StatisticBar
      class={props.class}
      statistics={[
        { label: 'Distance', value: () => formatDistance(props.route?.length) },
        {
          label: 'Duration',
          value: () =>
            props.statistics.state === 'ready' || props.statistics.state === 'refreshing'
              ? formatDuration(props.statistics().routeDurationMs / (60 * 1000))
              : formatRouteDuration(props.route),
        },
      ]}
    />
  )
}

export default RouteStatisticsBar
