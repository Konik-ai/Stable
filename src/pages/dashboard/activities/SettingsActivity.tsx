import { createResource, For, Show, createSignal } from 'solid-js'
import type { JSX, VoidComponent, Resource } from 'solid-js'

import { getDevice, getDeviceUsers, grantDeviceReadPermission, removeDeviceReadPermission, unpairDevice } from '~/api/devices'
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
  const [deviceName] = createResource(props.device, getDeviceName)
  const [deviceUsers, { refetch: refetchDeviceUsers }] = createResource(() => props.dongleId, getDeviceUsers)

  const [unpair, unpairData] = useAction(async () => {
    const { success } = await unpairDevice(props.dongleId)
    if (success) window.location.href = window.location.origin
  })

  const [shareLoading, setShareLoading] = createSignal(false)
  const share: JSX.EventHandler<HTMLFormElement, SubmitEvent> = async (event) => {
    event.preventDefault()
    setShareLoading(true)
    const formData = new FormData(event.target as HTMLFormElement)
    const email = formData.get('email') as string
    const { success } = await grantDeviceReadPermission(props.dongleId, email)
    setShareLoading(false)
    if (success) {
      refetchDeviceUsers()
      formRef?.reset()
    }
  }

  const [unshareLoading, setUnshareLoading] = createSignal(false)

  const unshare = async (email: string) => {
    setUnshareLoading(true)
    const { success } = await removeDeviceReadPermission(props.dongleId, email)
    if (success) refetchDeviceUsers()
    setUnshareLoading(false)
  }

  let formRef: HTMLFormElement | undefined

  return (
    <div class="flex flex-col gap-4">
      <h2 class="text-lg">{deviceName()}</h2>
      <Show when={props.device()?.is_owner}>
        <div class="flex flex-col gap-2">
          <h3 class="text-md">{(deviceUsers() || []).length - 1 > 0 ? 'shared with:' : 'share device'}</h3>
          <For each={deviceUsers()} fallback={<div>loading</div>}>
            {(user) => (
              <Show when={user.permission !== 'owner'}>
                <div class="flex items-center gap-2 justify-between">
                  <div>{user.email}</div>
                  <Button color="error" onClick={() => unshare(user.email)} loading={unshareLoading()}>
                    <Icon name="delete" />
                  </Button>
                </div>
              </Show>
            )}
          </For>
          <form onSubmit={share} class="flex items-center gap-2 justify-between" method="post" ref={formRef}>
            <TextField label="email" id="email-box" name="email" class="w-full" />
            <Button color="secondary" type="submit" loading={shareLoading()}>
              <Icon name="share" />
            </Button>
          </form>
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
