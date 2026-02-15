import { createEffect, createResource, createSignal, For, Index, onCleanup, onMount, Show, Suspense, type VoidComponent } from 'solid-js'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
dayjs.extend(utc)
dayjs.extend(timezone)

import { fetcher } from '~/api'
import { generateRouteStatistics, getTimelineEvents } from '~/api/derived'
import Card, { CardContent, CardHeader } from '~/components/material/Card'
import Icon from '~/components/material/Icon'
import RouteEventStrip from '~/components/RouteEventStrip'
import RouteStatisticsBar from '~/components/RouteStatisticsBar'
import { getPlaceName } from '~/map/geocode'
import type { Route } from '~/api/types'
import { parseTimestamp } from '~/utils/format'

interface RouteCardProps {
  route: Route
}

const RouteCard: VoidComponent<RouteCardProps> = (props) => {
  const startTime = () => parseTimestamp(props.route.start_time!).local()
  const [events] = createResource(() => props.route, getTimelineEvents, { initialValue: [] })
  const statistics = () => generateRouteStatistics(props.route, events())

  const endTime = () => {
    const start = startTime()
    const rawEnd = props.route.end_time

    // Some very short routes come back with `end_time: 0` which renders as 4:00 PM (epoch) in local time.
    if (rawEnd !== null && rawEnd !== undefined && rawEnd !== 0) {
      const parsed = parseTimestamp(rawEnd).local()
      if (parsed.isValid() && parsed.isAfter(start)) return parsed
    }

    // Fall back to derived duration when end_time is missing/invalid.
    if (events.state === 'ready' || events.state === 'refreshing') {
      const durMs = statistics().routeDurationMs
      if (Number.isFinite(durMs) && durMs > 0) return start.add(durMs, 'millisecond')
    }

    return start
  }
  const [location] = createResource(async () => {
    const startPos = [props.route.start_lng || 0, props.route.start_lat || 0]
    const endPos = [props.route.end_lng || 0, props.route.end_lat || 0]
    const startPlace = await getPlaceName(startPos)
    const endPlace = await getPlaceName(endPos)
    if (!startPlace && !endPlace) return ''
    if (!endPlace || startPlace === endPlace) return startPlace
    if (!startPlace) return endPlace
    return `${startPlace} to ${endPlace}`
  })

  return (
    <Card class="max-w-none" href={`/${props.route.dongle_id}/${props.route.fullname.slice(17)}`} activeClass="md:before:bg-primary">
      <CardHeader
        headline={`${startTime().format('h:mm A')} to ${endTime().format('h:mm A')}`}
        subhead={<Suspense fallback={<div class="h-[20px] w-auto skeleton-loader rounded-xs" />}>{location()}</Suspense>}
        trailing={
          <Suspense>
            <Show when={(events.state === 'ready' || events.state === 'refreshing') && statistics().userFlags}>
              <div class="flex items-center justify-center rounded-full p-1 border-amber-300 border-2">
                <Icon class="text-yellow-300" size="24" name="flag" filled />
              </div>
            </Show>
          </Suspense>
        }
      />

      <CardContent>
        <RouteStatisticsBar
          route={props.route}
          statistics={events.state === 'ready' || events.state === 'refreshing' ? statistics() : undefined}
        />
      </CardContent>
      <RouteEventStrip class="h-2.5 w-full" route={props.route} events={events()} />
    </Card>
  )
}

const Sentinel = (props: { onTrigger: () => void }) => {
  let sentinel!: HTMLDivElement
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries[0].isIntersecting) return
      props.onTrigger()
    },
    { threshold: 0.1 },
  )
  onMount(() => observer.observe(sentinel))
  onCleanup(() => observer.disconnect())
  return <div ref={sentinel} class="h-10 w-full" />
}

const PAGE_SIZE = 10

const RouteList: VoidComponent<{ dongleId: string }> = (props) => {
  const seenRoutes = new Set<string>()
  // Use offset-based pagination to avoid backend cursor inconsistencies across deployments.
  const endpoint = () => `/v1/devices/${props.dongleId}/routes?limit=${PAGE_SIZE}`
  const [hasMore, setHasMore] = createSignal(true)

  const routeKey = (route: Route): string => {
    // `fullname` is stable and unique for a route.
    if (route.fullname) return route.fullname
    return `${route.dongle_id}|${route.start_time ?? ''}|${route.end_time ?? ''}|${route.create_time ?? ''}`
  }

  const getKey = (page: number): string => (page > 0 ? `${endpoint()}&offset=${page * PAGE_SIZE}` : endpoint())

  const getPage = (page: number): Promise<Route[]> => {
    if (pages[page] === undefined) {
      pages[page] = (async () => {
        const fetched = await fetcher<Route[]>(getKey(page)).catch(() => [])
        if (fetched.length === 0) {
          setHasMore(false)
          return []
        }

        const unique = fetched.filter((r) => {
          const k = routeKey(r)
          if (seenRoutes.has(k)) return false
          seenRoutes.add(k)
          return true
        })

        // If the backend returns only routes we've already seen, we're stuck on a repeated page. Stop.
        if (unique.length === 0) {
          setHasMore(false)
          return []
        }

        if (fetched.length < PAGE_SIZE) setHasMore(false)
        return unique
      })()
    }
    return pages[page]
  }

  const pages: Promise<Route[]>[] = []
  const [size, setSize] = createSignal(1)
  const pageNumbers = () => Array.from({ length: size() })

  createEffect(() => {
    if (props.dongleId) {
      pages.length = 0
      setSize(1)
      setHasMore(true)
      seenRoutes.clear()
      prevDayHeader = null
    }
  })

  // Group and display headers for each day
  let prevDayHeader: string | null = null
  function getDayHeader(route: Route): string | null {
    const date = parseTimestamp(route.start_time!).local()
    let dayHeader = null
    if (date.isSame(dayjs(), 'day')) {
      dayHeader = `Today – ${date.format('dddd, MMM D')}`
    } else if (date.isSame(dayjs().subtract(1, 'day'), 'day')) {
      dayHeader = `Yesterday – ${date.format('dddd, MMM D')}`
    } else if (date.year() === dayjs().year()) {
      dayHeader = date.format('dddd, MMM D')
    } else {
      dayHeader = date.format('dddd, MMM D, YYYY')
    }

    if (dayHeader !== prevDayHeader) {
      prevDayHeader = dayHeader
      return dayHeader
    }
    return null
  }

  return (
    <div class="flex w-full flex-col justify-items-stretch gap-4">
      <For each={pageNumbers()}>
        {(_, i) => {
          const [routes] = createResource(() => i(), getPage)
          return (
            <Suspense
              fallback={
                <>
                  <h2 class="skeleton-loader rounded-md min-h-7"></h2>
                  <Index each={new Array(PAGE_SIZE)}>{() => <div class="skeleton-loader flex h-[140px] flex-col rounded-lg" />}</Index>
                </>
              }
            >
              <For each={routes()}>
                {(route) => {
                  const firstHeader = prevDayHeader === null
                  const dayHeader = getDayHeader(route)
                  return (
                    <>
                      <Show when={dayHeader}>
                        <Show when={!firstHeader}>
                          <div class="w-full" />
                        </Show>
                        <h2 class="px-4 text-lg font-bold text-on-surface-variant">{dayHeader}</h2>
                      </Show>
                      <RouteCard route={route} />
                    </>
                  )
                }}
              </For>
            </Suspense>
          )
        }}
      </For>
      <Show when={hasMore()}>
        <Sentinel onTrigger={() => setSize((size) => size + 1)} />
      </Show>
    </div>
  )
}

export default RouteList
