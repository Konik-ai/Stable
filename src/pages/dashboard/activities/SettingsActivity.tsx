import { createEffect, createResource, createSignal, Show } from 'solid-js'
import type { Resource, VoidComponent } from 'solid-js'

import { getDevice, getDevices, setDeviceAlias, unpairDevice } from '~/api/devices'
import TextField from '~/components/material/TextField'
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
  const [myDevices] = createResource(getDevices)

  const ownerDevice = () => myDevices()?.find((d) => d.dongle_id === props.dongleId)
  const isOwner = () => !!ownerDevice()?.is_owner

  const [aliasDraft, setAliasDraft] = createSignal('')
  const [aliasSaved, setAliasSaved] = createSignal<string | undefined>(undefined)
  const deviceTitle = () => {
    const d = ownerDevice() ?? props.device()
    if (!d) return ''
    const alias = aliasSaved()
    return getDeviceName({ ...d, alias: alias ?? d.alias })
  }

  createEffect(() => {
    const d = ownerDevice() ?? props.device()
    if (!d) return
    setAliasDraft(d.alias ?? '')
    setAliasSaved(d.alias ?? '')
  })

  const [renameLoading, setRenameLoading] = createSignal(false)
  const [renameError, setRenameError] = createSignal<string | undefined>(undefined)
  const saveAlias = async () => {
    if (!isOwner()) return
    setRenameError(undefined)
    setRenameLoading(true)
    try {
      const updated = await setDeviceAlias(props.dongleId, aliasDraft().trim())
      setAliasSaved(updated.alias)
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : String(err))
    } finally {
      setRenameLoading(false)
    }
  }

  const [unpair, unpairData] = useAction(async () => {
    const { success } = await unpairDevice(props.dongleId)
    if (success) {
      window.location.href = window.location.origin
    }
  })

  return (
    <div class="flex flex-col gap-4">
      <h2 class="text-lg">{deviceTitle()}</h2>

      <Show when={isOwner()}>
        <div class="flex flex-col gap-2">
          <h3 class="text-md">Rename device</h3>
          <div class="flex items-center gap-2">
            <TextField class="w-full" label="Device name" value={aliasDraft()} onInput={(e) => setAliasDraft(e.currentTarget.value)} />
            <Button color="secondary" leading={<Icon name="check" />} onClick={saveAlias} loading={renameLoading()}>
              Save
            </Button>
          </div>
          <Show when={renameError()}>
            <div class="flex gap-2 rounded-sm bg-surface-container-high p-2 text-sm text-on-surface">
              <Icon class="text-error" name="error" size="20" />
              {renameError()}
            </div>
          </Show>
        </div>
      </Show>

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
