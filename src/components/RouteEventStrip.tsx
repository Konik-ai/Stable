import { For, type VoidComponent } from 'solid-js'
import clsx from 'clsx'

import type { TimelineEvent } from '~/api/derived'
import type { Route } from '~/api/types'
import { getRouteDuration } from '~/utils/format'

const RouteEventStrip: VoidComponent<{ class?: string; route: Route | undefined; events: TimelineEvent[] }> = (props) => {
  const durationMs = () => getRouteDuration(props.route)?.asMilliseconds() ?? 0

  return (
    <div
      class={clsx(
        'relative isolate overflow-hidden bg-blue-900',
        'after:absolute after:inset-0 after:bg-gradient-to-b after:from-black/0 after:via-black/10 after:to-black/30',
        props.class,
      )}
      title="Disengaged"
    >
      <For each={props.events}>
        {(event) => {
          const duration = durationMs()
          if (duration <= 0) return null

          let left = ''
          let width = ''
          switch (event.type) {
            case 'engaged':
            case 'overriding':
            case 'alert': {
              const { route_offset_millis, end_route_offset_millis } = event
              const offsetPct = (route_offset_millis / duration) * 100
              const endOffsetPct = (end_route_offset_millis / duration) * 100
              const widthPct = endOffsetPct - offsetPct

              left = `${offsetPct}%`
              width = `${widthPct}%`
              break
            }
            case 'user_flag': {
              const { route_offset_millis } = event
              const offsetPct = (route_offset_millis / duration) * 100
              const widthPct = (1000 / duration) * 100

              left = `${offsetPct}%`
              width = `${widthPct}%`
              break
            }
          }

          let classes = ''
          let title = ''
          switch (event.type) {
            case 'engaged':
              title = 'Engaged'
              classes = 'bg-green-800 min-w-[1px]'
              break
            case 'overriding':
              title = 'Overriding'
              classes = 'bg-gray-500 min-w-[1px]'
              break
            case 'alert':
              if (event.alertStatus === 1) {
                title = 'User prompt alert'
                classes = 'bg-amber-600'
              } else {
                title = 'Critical alert'
                classes = 'bg-red-600'
              }
              classes += ' min-w-[2px]'
              break
            case 'user_flag':
              title = 'User flag'
              classes = 'bg-yellow-500 min-w-[2px]'
              break
          }

          const zIndex = {
            engaged: '1',
            overriding: '2',
            alert: '3',
            user_flag: '4',
          }[event.type]

          return (
            <div
              title={title}
              class={clsx('absolute top-0 h-full', classes)}
              style={{
                left,
                width,
                'z-index': zIndex,
              }}
            />
          )
        }}
      </For>
    </div>
  )
}

export default RouteEventStrip
