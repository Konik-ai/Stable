import { For, Show, Suspense, createMemo, type VoidComponent } from 'solid-js'
import { useLocation } from '@solidjs/router'
import clsx from 'clsx'

import { useDrawerContext } from '~/components/material/Drawer'
import List, { ListItem, ListItemContent } from '~/components/material/List'
import type { Device } from '~/api/types'
import { getDeviceName } from '~/utils/device'
import storage from '~/utils/storage'

type DeviceListProps = {
  class?: string
  devices: Device[] | undefined
}

const DeviceList: VoidComponent<DeviceListProps> = (props) => {
  const location = useLocation()
  const { setOpen } = useDrawerContext()
  const ownedDevices = createMemo(() => props.devices?.filter((device) => device.is_owner) ?? [])
  const sharedDevices = createMemo(() => props.devices?.filter((device) => !device.is_owner) ?? [])

  const isSelected = (device: Device) => location.pathname.includes(device.dongle_id)
  const onClick = (device: Device) => () => {
    setOpen(false)
    storage.setItem('lastSelectedDongleId', device.dongle_id)
  }

  return (
    <List variant="nav" class={props.class}>
      <Suspense fallback={<div class="h-14 skeleton-loader rounded-xl" />}>
        <Show
          when={ownedDevices().length > 0 || sharedDevices().length > 0}
          fallback={<span class="mx-2 text-md text-on-surface-variant">No devices found</span>}
        >
          <For each={ownedDevices()}>
            {(device) => (
              <ListItem
                variant="nav"
                leading={<div class={clsx('m-2 size-2 shrink-0 rounded-full', device.is_online ? 'bg-green-400' : 'bg-gray-400')} />}
                selected={isSelected(device)}
                onClick={onClick(device)}
                href={`/${device.dongle_id}`}
                activeClass="before:bg-primary"
              >
                <ListItemContent
                  headline={<span class="font-medium">{getDeviceName(device)}</span>}
                  subhead={<span class="font-mono text-xs lowercase">{device.dongle_id}</span>}
                />
              </ListItem>
            )}
          </For>

          <Show when={sharedDevices().length > 0}>
            <div class="px-4 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Shared devices</div>
            <For each={sharedDevices()}>
              {(device) => (
                <ListItem
                  variant="nav"
                  leading={<div class={clsx('m-2 size-2 shrink-0 rounded-full', device.is_online ? 'bg-green-400' : 'bg-gray-400')} />}
                  selected={isSelected(device)}
                  onClick={onClick(device)}
                  href={`/${device.dongle_id}`}
                  activeClass="before:bg-primary"
                >
                  <ListItemContent
                    headline={<span class="font-medium">{getDeviceName(device)}</span>}
                    subhead={<span class="font-mono text-xs lowercase">{device.dongle_id}</span>}
                  />
                </ListItem>
              )}
            </For>
          </Show>
        </Show>
      </Suspense>
    </List>
  )
}

export default DeviceList
