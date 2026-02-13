import { createContext, createResource, createSignal, Show, useContext, type ParentComponent } from 'solid-js'

import { remotePinStatus, remotePinVerify } from '~/api/athena'
import Button from '~/components/material/Button'
import Icon from '~/components/material/Icon'
import TextField from '~/components/material/TextField'

type Props = {
  dongleId: string
  featureLabel: string
}

type DevicePinAuthContextValue = {
  authToken: () => string | undefined
}

const DevicePinAuthContext = createContext<DevicePinAuthContextValue>()

export const useDevicePinAuth = (): DevicePinAuthContextValue => {
  const ctx = useContext(DevicePinAuthContext)
  return ctx ?? { authToken: () => undefined }
}

const sanitizePin = (value: string) => value.replace(/\D/g, '').slice(0, 12)
const isValidPin = (value: string) => /^\d{4,12}$/.test(value)
const isWrongPinError = (msg: string) => /incorrect pin/i.test(msg) || /^wrong pin\b/i.test(msg)

const DevicePinGate: ParentComponent<Props> = (props) => {
  const [mode, setMode] = createSignal<'loading' | 'enter' | 'blocked'>('loading')
  const [pin, setPin] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [lockedS, setLockedS] = createSignal<number>(0)

  const [unlocked, setUnlocked] = createSignal(false)
  const [authToken, setAuthToken] = createSignal<string | undefined>(undefined)

  const refreshStatus = async (opts?: { soft?: boolean }) => {
    const soft = !!opts?.soft

    if (!soft) {
      setError(null)
      setLockedS(0)
      setMode('loading')
      setUnlocked(false)
      setAuthToken(undefined)
      setPin('')
    } else {
      // Keep current UI/error; only refresh lock state (and whether the device requires a PIN).
      setLockedS(0)
    }

    const resp = await remotePinStatus(props.dongleId)
    if (resp.error) {
      if (!soft) {
        setError(String(resp.error))
        setMode('enter')
      }
      return
    }
    const st = resp.result
    if (!st) {
      if (!soft) {
        setError('Failed to get PIN status')
        setMode('enter')
      }
      return
    }
    setLockedS(st.lockRemainingS || 0)

    if (!soft) {
      setMode(st.set ? 'enter' : 'blocked')
    } else if (!st.set) {
      // If the device PIN was cleared while we're here, force the blocked screen.
      setMode('blocked')
    }
  }

  // Refresh on first mount and when dongle changes.
  createResource(() => props.dongleId, async () => {
    await refreshStatus()
    return true
  })

  const unlockWithPin = async (enteredPin: string) => {
    const resp = await remotePinVerify(props.dongleId, enteredPin)
    if (resp.error) throw new Error(resp.error)
    const r = resp.result
    if (!r) throw new Error('PIN failed')
    if (r.lockRemainingS && r.lockRemainingS > 0) {
      setLockedS(r.lockRemainingS)
    }
    if (!r.success) throw new Error(r.error || 'PIN failed')
    if (!r.token) throw new Error('Device did not return an auth token')
    setAuthToken(r.token)
    setUnlocked(true)
  }

  const submit = async (e: SubmitEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (mode() === 'enter') {
        if (!isValidPin(pin())) throw new Error('PIN must be 4-12 digits')
        await unlockWithPin(pin())
        return
      }
    } catch (err) {
      const msg = (err as Error).message || 'PIN failed'
      setError(isWrongPinError(msg) ? 'Wrong PIN.' : msg)
      setPin('')
      await refreshStatus({ soft: true })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Show
      when={unlocked()}
      fallback={
        <div class="px-4 pb-10">
          <div class="max-w-lg rounded-lg bg-surface-container-low p-6 shadow-md">
            <div class="flex items-center gap-2">
              <div class="inline-flex size-10 items-center justify-center rounded-full bg-primary-container text-on-primary-container">
                <Icon name="info" filled />
              </div>
              <div class="flex flex-col">
                <div class="text-lg font-semibold">
                  {mode() === 'blocked' ? 'PIN not set up' : 'Enter PIN'}
                </div>
                <div class="text-sm text-on-surface-variant">
                  {mode() === 'blocked'
                    ? `Set up a PIN on your device to use ${props.featureLabel}.`
                    : `Enter your PIN to access ${props.featureLabel}.`}
                </div>
              </div>
            </div>

            <Show when={lockedS() > 0}>
              <div class="mt-4 rounded-md bg-surface-container-high p-3 text-sm text-on-surface-variant">Locked. Try again in {lockedS()}s.</div>
            </Show>

            <Show when={error()}>
              <div class="mt-4 rounded-md bg-surface-container-high p-3 text-sm text-error">{error()}</div>
            </Show>

            <Show when={mode() !== 'blocked'}>
              <form class="mt-5 flex flex-col gap-3" onSubmit={submit}>
                <TextField
                  label="PIN"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  name="device_pin"
                  required
                  minLength={4}
                  pattern="[0-9]{4,12}"
                  maxLength={12}
                  disabled={mode() === 'loading' || loading() || lockedS() > 0}
                  value={pin()}
                  onInput={(e) => setPin(sanitizePin(e.currentTarget.value))}
                />

                <div class="mt-1 flex flex-wrap gap-3">
                  <Button
                    color="primary"
                    type="submit"
                    loading={loading()}
                    disabled={mode() === 'loading' || loading() || lockedS() > 0 || !isValidPin(pin())}
                  >
                    Unlock
                  </Button>
                </div>

                <Show when={mode() === 'enter'}>
                  <div class="text-xs text-on-surface-variant">
                    Forgot your PIN? The owner can reset it from device settings.
                  </div>
                </Show>
              </form>
            </Show>
          </div>
        </div>
      }
    >
      <DevicePinAuthContext.Provider value={{ authToken }}>
        {props.children}
      </DevicePinAuthContext.Provider>
    </Show>
  )
}

export default DevicePinGate
