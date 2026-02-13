import { createSignal, onCleanup, onMount, Show, type VoidComponent } from 'solid-js'

import { remoteSshRead, remoteSshResize, remoteSshStart, remoteSshStop, remoteSshWrite } from '~/api/athena'
import DevicePinGate, { useDevicePinAuth } from '~/components/DevicePinGate'
import Button from '~/components/material/Button'
import IconButton from '~/components/material/IconButton'
import TopAppBar from '~/components/material/TopAppBar'

const POLL_MS = 120
const MAX_BUFFER = 250_000
const WRITE_FLUSH_MS = 20
const POLL_ACTIVE_MS = 40
const POLL_IDLE_MS = 200
const ACTIVE_WINDOW_MS = 2000

const stripTerminalControlSequences = (value: string) =>
  value
    // OSC sequences (e.g. title changes): ESC ] ... BEL or ESC \
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    // CSI sequences (colors, cursor movement, bracketed paste toggles, etc)
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    // Remaining single-character ESC sequences
    .replace(/\x1B[@-_]/g, '')
    // Control chars except newline and tab
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')

const decodeBase64 = (value: string) => {
  if (!value) return ''
  const raw = atob(value)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i)
  }
  const decoded = new TextDecoder().decode(bytes).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return stripTerminalControlSequences(decoded)
}

const RemoteSshTerminal: VoidComponent<{ dongleId: string }> = (props) => {
  const { authToken } = useDevicePinAuth()
  const [sessionId, setSessionId] = createSignal<string | null>(null)
  const [connected, setConnected] = createSignal(false)
  const [connecting, setConnecting] = createSignal(false)
  const [output, setOutput] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)
  const [exitCode, setExitCode] = createSignal<number | null>(null)
  const [focused, setFocused] = createSignal(false)

  let terminalRef: HTMLDivElement | undefined
  let pollTimer: number | undefined
  let pollInFlight = false
  let activeUntil = 0

  let writeTimer: number | undefined
  let pendingWrite = ''
  let writeChain: Promise<void> = Promise.resolve()

  const markActive = () => {
    activeUntil = Date.now() + ACTIVE_WINDOW_MS
  }

  const appendOutput = (text: string) => {
    if (!text) return
    markActive()
    setOutput((prev) => {
      const next = (prev + text).slice(-MAX_BUFFER)
      return next
    })
    queueMicrotask(() => {
      if (terminalRef) {
        terminalRef.scrollTop = terminalRef.scrollHeight
      }
    })
  }

  const getTermSize = () => {
    const width = terminalRef?.clientWidth ?? 960
    const height = terminalRef?.clientHeight ?? 560
    const cols = Math.max(40, Math.floor(width / 9))
    const rows = Math.max(16, Math.floor(height / 18))
    return { cols, rows }
  }

  const stopPolling = () => {
    if (pollTimer !== undefined) {
      window.clearTimeout(pollTimer)
      pollTimer = undefined
    }
  }

  const schedulePoll = (immediate: boolean = false) => {
    stopPolling()
    if (!connected() || pollInFlight) return
    const delay = immediate ? 0 : Date.now() < activeUntil ? POLL_ACTIVE_MS : POLL_IDLE_MS
    pollTimer = window.setTimeout(() => void poll(), delay)
  }

  const disconnect = async () => {
    stopPolling()
    if (writeTimer !== undefined) {
      window.clearTimeout(writeTimer)
      writeTimer = undefined
    }
    pendingWrite = ''
    const sid = sessionId()
    setConnected(false)
    setSessionId(null)
    if (sid) {
      try {
        await remoteSshStop(props.dongleId, sid, authToken())
      } catch {
        // no-op
      }
    }
  }

  const poll = async () => {
    const sid = sessionId()
    if (!sid || !connected() || pollInFlight) return
    pollInFlight = true
    try {
      const resp = await remoteSshRead(props.dongleId, sid, 262_144, authToken())
      if (resp.error) {
        throw new Error(resp.error)
      }
      const result = resp.result
      if (!result) return
      if (!result.success) {
        throw new Error(result.error || 'Remote SSH disabled')
      }
      appendOutput(decodeBase64(result.data))
      if (result.closed) {
        setExitCode(result.exitCode)
        setConnected(false)
        setSessionId(null)
        stopPolling()
      }
    } catch (err) {
      setError((err as Error).message || 'Remote SSH read failed')
      setConnected(false)
      setSessionId(null)
      stopPolling()
    } finally {
      pollInFlight = false
      if (connected()) schedulePoll()
    }
  }

  const flushWrites = () => {
    const sid = sessionId()
    if (!sid || !connected()) return
    if (!pendingWrite) return

    const chunk = pendingWrite
    pendingWrite = ''

    writeChain = writeChain
      .then(async () => {
        markActive()
        const resp = await remoteSshWrite(props.dongleId, sid, chunk, authToken())
        if (resp.error) {
          throw new Error(resp.error)
        }
        if (resp.result && !resp.result.success) {
          throw new Error(resp.result.error || 'Remote SSH disabled')
        }
        // Try to pull echoed output asap after sending input.
        schedulePoll(true)
      })
      .catch(async (err) => {
        setError((err as Error).message || 'Failed to send input')
        await disconnect()
      })
      .finally(() => {
        if (connected() && pendingWrite) {
          // If more keys came in while sending, flush again quickly.
          writeTimer = window.setTimeout(flushWrites, 0)
        }
      })
  }

  const queueWrite = (data: string) => {
    if (!data) return
    if (!connected()) return
    markActive()
    pendingWrite += data
    if (writeTimer === undefined) {
      writeTimer = window.setTimeout(() => {
        writeTimer = undefined
        flushWrites()
      }, WRITE_FLUSH_MS)
    }
  }

  const connect = async () => {
    if (connecting()) return
    setConnecting(true)
    setError(null)
    setExitCode(null)
    setOutput('')
    try {
      const { cols, rows } = getTermSize()
      const resp = await remoteSshStart(props.dongleId, cols, rows, authToken())
      if (resp.error) {
        throw new Error(resp.error)
      }
      if (resp.result && !resp.result.success) {
        throw new Error(resp.result.error || 'Remote SSH disabled')
      }
      const sid = resp.result?.sessionId
      if (!sid) {
        throw new Error('Device did not return a session id')
      }
      setSessionId(sid)
      setConnected(true)
      markActive()
      schedulePoll(true)
      terminalRef?.focus()
    } catch (err) {
      const msg = (err as Error).message || 'Failed to connect'
      setError(msg === 'Remote SSH disabled' ? 'Remote SSH disabled' : msg)
      setConnected(false)
      setSessionId(null)
    } finally {
      setConnecting(false)
    }
  }

  const sendData = async (data: string) => {
    const sid = sessionId()
    if (!sid || !connected()) return
    try {
      const resp = await remoteSshWrite(props.dongleId, sid, data, authToken())
      if (resp.error) {
        throw new Error(resp.error)
      }
      if (resp.result && !resp.result.success) {
        throw new Error(resp.result.error || 'Remote SSH disabled')
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to send input')
      await disconnect()
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!connected()) return

    if (e.key === 'Enter') {
      e.preventDefault()
      queueWrite('\r')
      return
    }
    if (e.key === 'Backspace') {
      e.preventDefault()
      queueWrite('\x7f')
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      queueWrite('\t')
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      queueWrite('\x1b[A')
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      queueWrite('\x1b[B')
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      queueWrite('\x1b[C')
      return
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      queueWrite('\x1b[D')
      return
    }
    if (e.ctrlKey && e.key.length === 1) {
      e.preventDefault()
      const code = e.key.toUpperCase().charCodeAt(0)
      if (code >= 64 && code <= 95) {
        queueWrite(String.fromCharCode(code - 64))
      }
      return
    }
    if (!e.ctrlKey && !e.metaKey && e.key.length === 1) {
      e.preventDefault()
      queueWrite(e.key)
    }
  }

  onMount(() => {
    const onResize = () => {
      const sid = sessionId()
      if (!sid || !connected()) return
      const { cols, rows } = getTermSize()
      void remoteSshResize(props.dongleId, sid, cols, rows, authToken())
    }
    window.addEventListener('resize', onResize)
    onCleanup(() => window.removeEventListener('resize', onResize))
  })

  onCleanup(() => {
    void disconnect()
  })

  return (
    <div class="flex flex-col gap-4 px-4 pb-8">
      <div class="flex items-center gap-3">
        <Button color="primary" onClick={() => (connected() ? void disconnect() : void connect())} loading={connecting()}>
          {connected() ? 'Disconnect' : 'Connect'}
        </Button>
        <Show when={exitCode() !== null}>
          <span class="text-sm text-on-surface-variant">Session exited with code {exitCode()}</span>
        </Show>
      </div>
      <Show when={error()}>
        <div class="rounded-md bg-surface-container-high p-3 text-sm text-error">{error()}</div>
      </Show>
      <div
        ref={terminalRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPaste={(e) => {
          if (!connected()) return
          e.preventDefault()
          const text = e.clipboardData?.getData('text/plain') || ''
          if (text) queueWrite(text)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        class="h-[65vh] overflow-auto rounded-lg border border-outline-variant bg-black p-4 font-mono text-sm text-green-300 outline-none focus:ring-2 focus:ring-primary"
      >
        <pre class="whitespace-pre-wrap break-words">
          {output()}
          <Show when={connected()}>
            <span class={focused() ? 'term-cursor term-cursor-active' : 'term-cursor term-cursor-inactive'}>{'\u00a0'}</span>
          </Show>
        </pre>
      </div>
    </div>
  )
}

const RemoteSshActivity: VoidComponent<{ dongleId: string }> = (props) => (
  <>
    <TopAppBar component="h2" leading={<IconButton class="md:hidden" name="arrow_back" href={`/${props.dongleId}`} />}>
      Remote SSH
    </TopAppBar>
    <DevicePinGate dongleId={props.dongleId} featureLabel="Remote SSH">
      <RemoteSshTerminal dongleId={props.dongleId} />
    </DevicePinGate>
  </>
)

export default RemoteSshActivity
