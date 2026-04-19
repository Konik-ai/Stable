import { createEffect, createMemo, For, Index, onCleanup, onMount, Show, type VoidComponent } from 'solid-js'
import { createStore } from 'solid-js/store'
import { useInfiniteQuery } from '@tanstack/solid-query'
import { createVirtualizer } from '@tanstack/solid-virtual'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
dayjs.extend(utc)
dayjs.extend(timezone)

import { fetcher } from '~/api'
import type { TimelineEvent } from '~/api/derived'
import { getTimelineEventsInWorker } from '~/api/events-worker-client'
import { getRouteSpritesInWorker, type RouteSprites } from '~/api/sprites-worker-client'
import Card, { CardContent, CardHeader } from '~/components/material/Card'
import Icon from '~/components/material/Icon'
import RouteEventStrip from '~/components/RouteEventStrip'
import RouteSpriteStrip from '~/components/RouteSpriteStrip'
import RouteStatisticsBar from '~/components/RouteStatisticsBar'
import { getPlaceName } from '~/map/geocode'
import type { Route } from '~/api/types'
import { getRouteEndTime, parseTimestamp } from '~/utils/format'

const PAGE_SIZE = 20
const ESTIMATED_HEADER_SIZE = 40
const ESTIMATED_ROUTE_SIZE = 212
const OVERSCAN = 6
const PREFETCH_THRESHOLD = 20

type ListItem = { kind: 'header'; key: string; text: string } | { kind: 'route'; key: string; route: Route }

async function computeRouteLocation(route: Route): Promise<string> {
  const startPos: [number, number] = [route.start_lng || 0, route.start_lat || 0]
  const endPos: [number, number] = [route.end_lng || 0, route.end_lat || 0]
  const [startPlace, endPlace] = await Promise.all([getPlaceName(startPos), getPlaceName(endPos)])
  if (!startPlace && !endPlace) return 'No GPS for this route'
  if (!endPlace || startPlace === endPlace) return startPlace ?? ''
  if (!startPlace) return endPlace ?? ''
  return `${startPlace} to ${endPlace}`
}

interface RouteCardProps {
  route: Route
  location: string | undefined
  events: TimelineEvent[] | undefined
  sprites: RouteSprites | undefined
  requestEvents: (route: Route) => () => void
  requestSprites: (route: Route) => () => void
}

// Cards mounted for less than this many ms during a scroll don't fire their
// events query. Prevents rapid scroll from queueing hundreds of events.json
// fetches that would otherwise stall /routes pagination requests.
const EVENTS_FETCH_DELAY_MS = 800

const RouteCard: VoidComponent<RouteCardProps> = (props) => {
  let cancelEvents: (() => void) | undefined
  let cancelSprites: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  onMount(() => {
    timer = setTimeout(() => {
      cancelEvents = props.requestEvents(props.route)
      cancelSprites = props.requestSprites(props.route)
    }, EVENTS_FETCH_DELAY_MS)
  })

  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer)
    cancelEvents?.()
    cancelSprites?.()
  })

  const startTime = () => parseTimestamp(props.route.start_time!).local()
  const events = () => props.events ?? []
  const hasUserFlag = () => events().some((ev) => ev.type === 'user_flag')

  const endTime = () => getRouteEndTime(props.route)?.local() ?? startTime()

  return (
    <Card class="max-w-none" href={`/${props.route.dongle_id}/${props.route.fullname.slice(17)}`} activeClass="md:before:bg-primary">
      <CardHeader
        headline={`${startTime().format('h:mm A')} to ${endTime().format('h:mm A')}`}
        subhead={
          <Show when={props.location !== undefined} fallback={<div class="h-[20px] w-auto skeleton-loader rounded-xs" />}>
            {props.location}
          </Show>
        }
        trailing={
          <Show when={hasUserFlag()}>
            <div class="flex items-center justify-center rounded-full p-1 border-amber-300 border-2">
              <Icon class="text-yellow-300" size="24" name="flag" filled />
            </div>
          </Show>
        }
      />
      <CardContent>
        <RouteStatisticsBar route={props.route} />
      </CardContent>
      <RouteSpriteStrip class="h-12 w-full" sprites={props.sprites} />
      <RouteEventStrip class="h-2.5 w-full" route={props.route} events={events()} />
    </Card>
  )
}

function getDayHeader(route: Route): string {
  const date = parseTimestamp(route.start_time!).local()
  if (date.isSame(dayjs(), 'day')) return `Today – ${date.format('dddd, MMM D')}`
  if (date.isSame(dayjs().subtract(1, 'day'), 'day')) return `Yesterday – ${date.format('dddd, MMM D')}`
  if (date.year() === dayjs().year()) return date.format('dddd, MMM D')
  return date.format('dddd, MMM D, YYYY')
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el?.parentElement ?? null
  while (node && node !== document.body) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') return node
    node = node.parentElement
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement
}

const RouteList: VoidComponent<{ dongleId: string }> = (props) => {
  let sentinelEl: HTMLDivElement | undefined
  // createStore gives granular reactivity: updating one route's location only
  // re-reads the card that depends on that key, not every mounted card.
  const [locations, setLocations] = createStore<Record<string, string>>({})
  const [eventsMap, setEventsMap] = createStore<Record<string, TimelineEvent[]>>({})
  const [spritesMap, setSpritesMap] = createStore<Record<string, RouteSprites>>({})

  // Tracks in-flight requests by fullname so two mounts of the same route
  // don't duplicate work. Each entry is the cancel fn from events-worker-client.
  const inflightEvents = new Map<string, () => void>()
  const inflightSprites = new Map<string, () => void>()

  // Called by RouteCard.onMount after the 800ms debounce. Returns a cancel
  // function the card calls on unmount. If the card unmounts before the
  // worker dispatches the request, the queue drops it; if it unmounts after
  // dispatch, the worker's response is discarded.
  const requestEvents = (route: Route): (() => void) => {
    const fullname = route.fullname
    if (fullname in eventsMap) return () => {}
    if (inflightEvents.has(fullname)) {
      // A stale inflight request for this route exists (card unmounted then
      // remounted fast). Leave it alone — it'll populate eventsMap when it
      // resolves, and the new card will pick it up reactively.
      return () => {}
    }
    const request = getTimelineEventsInWorker(route)
    inflightEvents.set(fullname, request.cancel)
    request.promise
      .then((timeline) => {
        inflightEvents.delete(fullname)
        setEventsMap(fullname, timeline)
      })
      .catch(() => {
        inflightEvents.delete(fullname)
      })
    return () => {
      if (inflightEvents.get(fullname) === request.cancel) {
        inflightEvents.delete(fullname)
      }
      request.cancel()
    }
  }

  const requestSprites = (route: Route): (() => void) => {
    const fullname = route.fullname
    if (fullname in spritesMap) return () => {}
    if (inflightSprites.has(fullname)) return () => {}
    const request = getRouteSpritesInWorker(route)
    inflightSprites.set(fullname, request.cancel)
    request.promise
      .then((sprites) => {
        inflightSprites.delete(fullname)
        setSpritesMap(fullname, sprites)
      })
      .catch(() => {
        inflightSprites.delete(fullname)
      })
    return () => {
      if (inflightSprites.get(fullname) === request.cancel) {
        inflightSprites.delete(fullname)
      }
      request.cancel()
    }
  }

  const routesQuery = useInfiniteQuery(() => ({
    queryKey: ['device-routes', props.dongleId],
    queryFn: ({ pageParam }) => fetcher<Route[]>(`/v1/devices/${props.dongleId}/routes?limit=${PAGE_SIZE}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (lastPage: Route[], _allPages: Route[][], lastPageParam: number) =>
      lastPage.length < PAGE_SIZE ? undefined : lastPageParam + PAGE_SIZE,
    staleTime: 60_000,
  }))

  // Kick off geocoding whenever new routes appear in routesQuery.data — runs
  // on both fresh fetches and cache-served remounts (queryFn is skipped for
  // cache hits, so this effect is the only reliable trigger). `seen` lives on
  // the component instance, so switching devices and coming back gives a fresh
  // set and re-populates the (fresh) locations store. reverseGeocode's own
  // position cache ensures we don't re-hit the network for repeat coords.
  const seen = new Set<string>()
  createEffect(() => {
    const pages = routesQuery.data?.pages
    if (!pages) return
    for (const page of pages) {
      for (const route of page) {
        if (seen.has(route.fullname)) continue
        seen.add(route.fullname)
        computeRouteLocation(route)
          .then((loc) => setLocations(route.fullname, loc))
          .catch((err) => console.error('[RouteList] geocode failed', route.fullname, err))
      }
    }
  })

  const items = createMemo<ListItem[]>(() => {
    const pages = routesQuery.data?.pages
    if (!pages) return []
    const result: ListItem[] = []
    let prev: string | null = null
    for (const page of pages) {
      for (const route of page) {
        const header = getDayHeader(route)
        if (header !== prev) {
          result.push({ kind: 'header', key: `h-${header}`, text: header })
          prev = header
        }
        result.push({ kind: 'route', key: route.fullname, route })
      }
    }
    return result
  })

  const virtualizer = createVirtualizer({
    get count() {
      return items().length
    },
    // Must re-query on every call: the sentinel ref isn't assigned until after
    // the component mounts, so the first call (during virtualizer setup) sees
    // sentinelEl=undefined and has to fall back. A cache would lock that wrong
    // fallback in, breaking scroll/pagination.
    getScrollElement: () => findScrollParent(sentinelEl ?? null),
    estimateSize: (index) => (items()[index]?.kind === 'header' ? ESTIMATED_HEADER_SIZE : ESTIMATED_ROUTE_SIZE),
    overscan: OVERSCAN,
    getItemKey: (index) => items()[index]?.key ?? index,
  })

  createEffect(() => {
    const all = items()
    if (all.length === 0) return
    const virtualItems = virtualizer.getVirtualItems()
    const last = virtualItems[virtualItems.length - 1]
    if (!last) return
    if (last.index >= all.length - PREFETCH_THRESHOLD && routesQuery.hasNextPage && !routesQuery.isFetchingNextPage) {
      void routesQuery.fetchNextPage()
    }
  })

  return (
    <div ref={sentinelEl} class="w-full">
      <Show
        when={!routesQuery.isPending}
        fallback={
          <div class="flex flex-col gap-4">
            <h2 class="skeleton-loader rounded-md min-h-7" />
            <Index each={new Array(PAGE_SIZE / 2)}>{() => <div class="skeleton-loader flex h-[140px] flex-col rounded-lg" />}</Index>
          </div>
        }
      >
        <div class="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          <For each={virtualizer.getVirtualItems()}>
            {(virtualItem) => {
              const item = () => items()[virtualItem.index]
              return (
                <div
                  class="absolute left-0 top-0 w-full"
                  style={{
                    height: `${virtualItem.size}px`,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <Show when={item()} keyed>
                    {(current) =>
                      current.kind === 'header' ? (
                        <h2 class="px-4 pt-2 pb-1 text-lg font-bold text-on-surface-variant">{current.text}</h2>
                      ) : (
                        <div class="pb-4">
                          <RouteCard
                            route={current.route}
                            location={locations[current.route.fullname]}
                            events={eventsMap[current.route.fullname]}
                            sprites={spritesMap[current.route.fullname]}
                            requestEvents={requestEvents}
                            requestSprites={requestSprites}
                          />
                        </div>
                      )
                    }
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}

export default RouteList
