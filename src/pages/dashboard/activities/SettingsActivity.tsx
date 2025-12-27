import { createResource, Show, createSignal } from 'solid-js'
import type { VoidComponent, Resource } from 'solid-js'

import { getDevice, unpairDevice } from '~/api/devices'
import type { Device } from '~/api/types'

import Button from '~/components/material/Button'
import Icon from '~/components/material/Icon'
import IconButton from '~/components/material/IconButton'
import TopAppBar from '~/components/material/TopAppBar'
import { getDeviceName } from '~/utils/device'

const useAction = <T,>(action: () => Promise<T>): [() => void, Resource<T>] => {
  const [source, setSource] = createSignal(false)
  const [data] = createResource(source, action)
  const trigger = () => setSource(true)
  return [trigger, data]
}

type PrimeActivityProps = {
  dongleId: string
}

const DeviceSettingsForm: VoidComponent<{ dongleId: string; device: Resource<Device> }> = (props) => {
  const [deviceName] = createResource(props.device, getDeviceName)

  const [unpair, unpairData] = useAction(async () => {
    const { success } = await unpairDevice(props.dongleId)
    if (success) window.location.href = window.location.origin
  })

  return (
    <div class="flex flex-col gap-4">
      <h2 class="text-lg">{deviceName()}</h2>
      <Show when={unpairData.error}>
        <div class="flex gap-2 rounded-sm bg-surface-container-high p-2 text-sm text-on-surface">
          <Icon class="text-error" name="error" size="20" />
          {unpairData.error?.message ?? unpairData.error?.cause ?? unpairData.error ?? 'Unknown error'}
        </div>
      </Show>
      <Button color="error" leading={<Icon name="delete" />} onClick={unpair} disabled={unpairData.loading}>
        Unpair this device
      </Button>
    </div>
  )
}

const SettingsActivity: VoidComponent<PrimeActivityProps> = (props) => {
  const [device] = createResource(() => props.dongleId, getDevice)

  return (
    <>
      <TopAppBar component="h2" leading={<IconButton class="md:hidden" name="arrow_back" href={`/${props.dongleId}`} />}>
        Device Settings
      </TopAppBar>
      <div class="flex flex-col gap-4 max-w-lg px-4">
        <DeviceSettingsForm dongleId={props.dongleId} device={device} />
      </div>
    </>
  )
}

export default SettingsActivity
