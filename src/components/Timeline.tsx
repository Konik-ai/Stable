import { For, createSignal, createEffect, onMount, onCleanup, Show, Suspense } from 'solid-js'
import type { VoidComponent } from 'solid-js'
import clsx from 'clsx'

import type { TimelineEvent } from '~/api/derived'
import { SPRITE_TILE_HEIGHT, SPRITE_TILE_WIDTH, type RouteSprites } from '~/api/sprites-worker-client'
import type { Route } from '~/api/types'
import { getRouteDuration } from '~/utils/format'

const PREVIEW_HEIGHT = 120
const PREVIEW_WIDTH = PREVIEW_HEIGHT * (SPRITE_TILE_WIDTH / SPRITE_TILE_HEIGHT)

function renderTimelineEvents(route: Route | undefined, events: TimelineEvent[]) {
  if (!route) return
  const duration = getRouteDuration(route)?.asMilliseconds() ?? 0
  return (
    <For each={events}>
      {(event) => {
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
  )
}

const MARKER_WIDTH = 3

interface TimelineProps {
  class?: string
  route: Route | undefined
  seekTime: number
  updateTime: (time: number) => void
  events: TimelineEvent[]
  sprites?: RouteSprites
}

type PreviewTile = {
  segmentUrl: string
  tileIndex: number
  tileCount: number
}

function getPreviewTile(route: Route, sprites: RouteSprites, offsetMs: number): PreviewTile | null {
  const n = sprites.segmentUrls.length
  if (n === 0) return null
  const starts = route.segment_start_times
  const ends = route.segment_end_times
  const routeStart = starts?.[0]
  if (routeStart === undefined) return null

  for (let i = 0; i < n; i++) {
    const segStart = (starts[i] ?? routeStart) - routeStart
    const segEnd = (ends[i] ?? starts[i + 1] ?? segStart + 60_000) - routeStart
    const segDur = Math.max(1, segEnd - segStart)
    if (offsetMs < segEnd || i === n - 1) {
      const tileCount = sprites.segmentTileCounts[i]
      const segmentUrl = sprites.segmentUrls[i]
      if (!tileCount || !segmentUrl) return null
      const fraction = Math.max(0, Math.min(1, (offsetMs - segStart) / segDur))
      const tileIndex = Math.min(tileCount - 1, Math.floor(fraction * tileCount))
      return { segmentUrl, tileIndex, tileCount }
    }
  }
  return null
}

const Timeline: VoidComponent<TimelineProps> = (props) => {
  // TODO: align to first camera frame event
  const [markerOffsetPct, setMarkerOffsetPct] = createSignal(0)
  const [isScrubbing, setIsScrubbing] = createSignal(false)
  const duration = () => getRouteDuration(props.route)?.asSeconds() ?? 0

  let ref!: HTMLDivElement

  onMount(() => {
    const updateMarker = (clientX: number) => {
      const rect = ref.getBoundingClientRect()
      const x = Math.min(Math.max(clientX - rect.left, 0), rect.width - MARKER_WIDTH)
      const fraction = x / rect.width
      // Update marker immediately without waiting for video
      setMarkerOffsetPct(fraction * 100)
      props.updateTime(duration() * fraction)
    }

    const onStart = () => {
      setIsScrubbing(true)
      const onMouseMove = (ev: MouseEvent) => {
        updateMarker(ev.clientX)
      }
      const onTouchMove = (ev: TouchEvent) => {
        if (ev.touches.length !== 1) return
        updateMarker(ev.touches[0].clientX)
      }
      const onStop = () => {
        setIsScrubbing(false)
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('touchmove', onTouchMove)
        window.removeEventListener('mouseup', onStop)
        window.removeEventListener('touchend', onStop)
        window.removeEventListener('touchcancel', onStop)
      }
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('touchmove', onTouchMove)
      window.addEventListener('mouseup', onStop)
      window.addEventListener('touchend', onStop)
      window.addEventListener('touchcancel', onStop)
    }

    const onMouseDown = (ev: MouseEvent) => {
      if (!props.route) return
      updateMarker(ev.clientX)
      onStart()
    }

    const onTouchStart = (ev: TouchEvent) => {
      if (ev.touches.length !== 1 || !props.route) return
      updateMarker(ev.touches[0].clientX)
      onStart()
    }

    ref.addEventListener('mousedown', onMouseDown)
    ref.addEventListener('touchstart', onTouchStart)
    onCleanup(() => {
      ref.removeEventListener('mousedown', onMouseDown)
      ref.removeEventListener('touchstart', onTouchStart)
    })
  })

  createEffect(() => {
    if (duration() === 0) setMarkerOffsetPct(0)
    else setMarkerOffsetPct((props.seekTime / duration()) * 100)
  })

  const preview = (): PreviewTile | null => {
    if (!isScrubbing() || !props.route || !props.sprites) return null
    const offsetMs = (markerOffsetPct() / 100) * duration() * 1000
    return getPreviewTile(props.route, props.sprites, offsetMs)
  }

  return (
    <div class="relative flex flex-col">
      <Show when={preview()}>
        {(p) => (
          <div
            class="pointer-events-none absolute bottom-full z-20 mb-3 overflow-hidden rounded-sm border-2 border-white shadow-lg"
            style={{
              width: `${PREVIEW_WIDTH}px`,
              height: `${PREVIEW_HEIGHT}px`,
              left: `clamp(0px, calc(${markerOffsetPct()}% - ${PREVIEW_WIDTH / 2}px), calc(100% - ${PREVIEW_WIDTH}px))`,
              'background-image': `url(${p().segmentUrl})`,
              'background-size': `auto ${PREVIEW_HEIGHT}px`,
              'background-position-x': `-${p().tileIndex * PREVIEW_WIDTH}px`,
              'background-position-y': '0',
              'background-repeat': 'no-repeat',
            }}
          />
        )}
      </Show>
      <div class="h-1 bg-surface-container-high">
        <div class="h-full bg-white" style={{ width: `calc(${markerOffsetPct()}% + 1px)` }} />
      </div>
      <div
        ref={ref!}
        class={clsx(
          'relative isolate flex h-8 cursor-pointer touch-none self-stretch rounded-b-md bg-blue-900',
          'after:absolute after:inset-0 after:rounded-b-md after:bg-gradient-to-b after:from-black/0 after:via-black/10 after:to-black/30',
          props.class,
        )}
        title="Disengaged"
      >
        <div class="absolute inset-0 size-full rounded-b-md overflow-hidden">
          <Suspense fallback={<div class="skeleton-loader size-full" />}>{renderTimelineEvents(props.route, props.events)}</Suspense>
        </div>
        <div
          class="absolute top-0 z-10 h-full"
          style={{
            width: `${MARKER_WIDTH}px`,
            left: `${markerOffsetPct()}%`,
          }}
        >
          <div class="absolute inset-x-0 h-full w-px bg-white" />
          <div class="absolute -bottom-1.5 left-1/2 -translate-x-[calc(50%+1px)]">
            <div class="size-0 border-x-8 border-b-[12px] border-x-transparent border-b-white" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default Timeline
