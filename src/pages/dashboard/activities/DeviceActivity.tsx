import { createResource, createSignal, Match, onCleanup, onMount, Show, Suspense, Switch, type VoidComponent } from 'solid-js'
import clsx from 'clsx'

import { makeAthenaCall } from '~/api/athena'
import { getDevice, SHARED_DEVICE } from '~/api/devices'
import { DrawerToggleButton, useDrawerContext } from '~/components/material/Drawer'
import Icon from '~/components/material/Icon'
import IconButton from '~/components/material/IconButton'
import TopAppBar from '~/components/material/TopAppBar'
import DeviceLocation from '~/components/DeviceLocation'
import DeviceStatistics from '~/components/DeviceStatistics'
import UploadQueue from '~/components/UploadQueue'
import { getDeviceName } from '~/utils/device'

import RouteList from '../components/RouteList'
import { resolved } from '~/utils/reactivity'

interface PeripheralState {
  peripheralState: {
    voltage: number
  }
}

const DeviceBatteryVoltage: VoidComponent<{ dongleId: string }> = (props) => {
  const [voltage] = createResource(
    () => props.dongleId,
    async (dongleId) => {
      const resp = await makeAthenaCall(dongleId, 'getMessage', { service: 'peripheralState', timeout: 5000 })
      return resp.result ? (resp.result as PeripheralState).peripheralState?.voltage : null
    },
  )

  return (
    <div
      class={clsx(
        'h-8 w-24 rounded-full flex items-center justify-center gap-2 bg-surface-container-high text-sm',
        voltage.loading && 'skeleton-loader',
      )}
      title="Detected Battery Voltage"
    >
      <Icon name="bolt" filled={resolved(voltage) && !!voltage.latest} size="20" />
      <Switch>
        <Match when={voltage.state === 'errored'}>Offline</Match>
        <Match when={resolved(voltage)}>
          <Show when={voltage.latest} fallback={<div class="text-sm">Offline</div>}>
            {(voltage) => <div class="text-sm">{(voltage() / 1000).toFixed(1)} V</div>}
          </Show>
        </Match>
      </Switch>
    </div>
  )
}

type DeviceActivityProps = {
  dongleId: string
}

const SHOW_BACK_TO_TOP_AT = 400

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el?.parentElement ?? null
  while (node && node !== document.body) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') return node
    node = node.parentElement
  }
  return null
}

const DeviceActivity: VoidComponent<DeviceActivityProps> = (props) => {
  // TODO: device should be passed in from DeviceList
  const [device] = createResource(() => props.dongleId, getDevice)
  // Resource as source of another resource blocks component initialization
  const deviceName = () => (device.latest ? getDeviceName(device.latest) : '')
  // TODO: remove this. if we're listing the routes for a device you should always be a user, this is for viewing public routes which are being removed
  const isDeviceUser = () => (device.loading ? true : device.latest?.is_owner || device.latest?.alias !== SHARED_DEVICE)
  const [queueVisible, setQueueVisible] = createSignal(false)
  const [showBackToTop, setShowBackToTop] = createSignal(false)

  let stickyEl: HTMLDivElement | undefined
  onMount(() => {
    const scrollEl = findScrollParent(stickyEl ?? null)
    if (!scrollEl) return
    const onScroll = () => setShowBackToTop(scrollEl.scrollTop > SHOW_BACK_TO_TOP_AT)
    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    onCleanup(() => scrollEl.removeEventListener('scroll', onScroll))
  })

  const scrollToTop = () => {
    findScrollParent(stickyEl ?? null)?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const { modal } = useDrawerContext()

  return (
    <>
      <TopAppBar
        class="font-bold sticky top-0 z-10 bg-background"
        leading={
          <Show when={!modal()} fallback={<DrawerToggleButton />}>
            <img alt="" src="/images/comma-white.png" class="h-8" />
          </Show>
        }
      >
        Stable
      </TopAppBar>
      <div class="flex flex-col gap-4 px-4 pb-4">
        <div class="h-min overflow-hidden rounded-lg bg-surface-container-low">
          <Suspense fallback={<div class="h-[240px] skeleton-loader size-full" />}>
            <DeviceLocation dongleId={props.dongleId} deviceName={deviceName()!} />
          </Suspense>
          <div class="flex items-center justify-between p-4">
            <Suspense fallback={<div class="h-[32px] skeleton-loader size-full rounded-xs" />}>
              <div class="inline-flex items-center gap-2">
                <div class={clsx('m-2 size-2 shrink-0 rounded-full', device.latest?.is_online ? 'bg-green-400' : 'bg-gray-400')} />

                {<div class="text-lg font-bold">{deviceName()}</div>}
              </div>
            </Suspense>
            <div class="flex gap-4">
              <DeviceBatteryVoltage dongleId={props.dongleId} />
              <IconButton name="videocam" href={`/${props.dongleId}/live`} />
              <IconButton name="terminal" href={`/${props.dongleId}/ssh`} />
              <IconButton name="settings" href={`/${props.dongleId}/settings`} />
            </div>
          </div>
          <Show when={isDeviceUser()}>
            <DeviceStatistics dongleId={props.dongleId} class="p-4" />
            <Show when={queueVisible()}>
              <UploadQueue dongleId={props.dongleId} />
            </Show>
            <button
              class={clsx(
                'flex w-full cursor-pointer justify-center rounded-b-lg bg-surface-container-lowest p-2',
                queueVisible() && 'border-t-2 border-t-surface-container-low',
              )}
              onClick={() => setQueueVisible(!queueVisible())}
            >
              <p class="mr-2">Upload Queue</p>
              <Icon class="text-zinc-500" name={queueVisible() ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} />
            </button>
          </Show>
        </div>
        <RouteList dongleId={props.dongleId} />
      </div>
      <div ref={stickyEl} class="sticky bottom-0 z-10 flex justify-end pointer-events-none p-4">
        <button
          type="button"
          class={clsx(
            'pointer-events-auto flex size-12 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg transition-opacity duration-200',
            showBackToTop() ? 'opacity-100' : 'opacity-0',
          )}
          onClick={scrollToTop}
          aria-label="Back to top"
          tabIndex={showBackToTop() ? 0 : -1}
        >
          <Icon name="arrow_upward" />
        </button>
      </div>
    </>
  )
}

export default DeviceActivity
