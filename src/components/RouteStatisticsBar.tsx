import type { VoidComponent } from 'solid-js'

import type { Route } from '~/api/types'
import { formatDistance, formatRouteDuration } from '~/utils/format'
import StatisticBar from './StatisticBar'

const RouteStatisticsBar: VoidComponent<{ class?: string; route: Route | undefined }> = (props) => {
  return (
    <StatisticBar
      class={props.class}
      statistics={[
        { label: 'Distance', value: () => formatDistance(props.route?.length) },
        { label: 'Duration', value: () => formatRouteDuration(props.route) },
      ]}
    />
  )
}

export default RouteStatisticsBar
