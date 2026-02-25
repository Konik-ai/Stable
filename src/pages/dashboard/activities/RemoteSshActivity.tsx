import { createSignal, onCleanup, onMount, Show, type VoidComponent } from 'solid-js'

import { remoteSshRead, remoteSshResize, remoteSshStart, remoteSshStop, remoteSshWrite } from '~/api/athena'
import DevicePinGate, { useDevicePinAuth } from '~/components/DevicePinGate'
import Button from '~/components/material/Button'
import IconButton from '~/components/material/IconButton'
import TopAppBar from '~/components/material/TopAppBar'

const MAX_BUFFER = 250_000
const WRITE_FLUSH_MS = 20
const POLL_ACTIVE_MS = 40
const POLL_IDLE_MS = 200
const ACTIVE_WINDOW_MS = 2000

// --- ANSI color support ---

const PALETTE_16: string[] = [
  '#000000',
  '#aa0000',
  '#00aa00',
  '#aa5500',
  '#0000aa',
  '#aa00aa',
  '#00aaaa',
  '#aaaaaa',
  '#555555',
  '#ff5555',
  '#55ff55',
  '#ffff55',
  '#5555ff',
  '#ff55ff',
  '#55ffff',
  '#ffffff',
]

const PALETTE_256: string[] = (() => {
  const c = [...PALETTE_16]
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        const rv = r ? r * 40 + 55 : 0
        const gv = g ? g * 40 + 55 : 0
        const bv = b ? b * 40 + 55 : 0
        c.push(`#${rv.toString(16).padStart(2, '0')}${gv.toString(16).padStart(2, '0')}${bv.toString(16).padStart(2, '0')}`)
      }
    }
  }
  for (let i = 0; i < 24; i++) {
    const v = (i * 10 + 8).toString(16).padStart(2, '0')
    c.push(`#${v}${v}${v}`)
  }
  return c
})()

interface SgrState {
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  fg: string | null
  bg: string | null
}

const resetSgr = (s: SgrState) => {
  s.bold = false
  s.dim = false
  s.italic = false
  s.underline = false
  s.fg = null
  s.bg = null
}

const sgrHasStyle = (s: SgrState) => s.bold || s.dim || s.italic || s.underline || s.fg !== null || s.bg !== null

const sgrToStyle = (s: SgrState): string => {
  const p: string[] = []
  if (s.bold) p.push('font-weight:bold')
  if (s.dim) p.push('opacity:0.5')
  if (s.italic) p.push('font-style:italic')
  if (s.underline) p.push('text-decoration:underline')
  if (s.fg) p.push(`color:${s.fg}`)
  if (s.bg) p.push(`background-color:${s.bg}`)
  return p.join(';')
}

function applySgrParams(paramStr: string, state: SgrState) {
  const nums = paramStr === '' ? [0] : paramStr.split(';').map(Number)
  let i = 0
  while (i < nums.length) {
    const n = nums[i]
    if (n === 0) resetSgr(state)
    else if (n === 1) state.bold = true
    else if (n === 2) state.dim = true
    else if (n === 3) state.italic = true
    else if (n === 4) state.underline = true
    else if (n === 22) {
      state.bold = false
      state.dim = false
    } else if (n === 23) state.italic = false
    else if (n === 24) state.underline = false
    else if (n >= 30 && n <= 37) state.fg = PALETTE_16[n - 30]
    else if (n === 38) {
      if (nums[i + 1] === 5 && nums[i + 2] !== undefined) {
        state.fg = PALETTE_256[nums[i + 2]] ?? null
        i += 2
      } else if (nums[i + 1] === 2 && nums[i + 4] !== undefined) {
        state.fg = `rgb(${nums[i + 2]},${nums[i + 3]},${nums[i + 4]})`
        i += 4
      }
    } else if (n === 39) state.fg = null
    else if (n >= 40 && n <= 47) state.bg = PALETTE_16[n - 40]
    else if (n === 48) {
      if (nums[i + 1] === 5 && nums[i + 2] !== undefined) {
        state.bg = PALETTE_256[nums[i + 2]] ?? null
        i += 2
      } else if (nums[i + 1] === 2 && nums[i + 4] !== undefined) {
        state.bg = `rgb(${nums[i + 2]},${nums[i + 3]},${nums[i + 4]})`
        i += 4
      }
    } else if (n === 49) state.bg = null
    else if (n >= 90 && n <= 97) state.fg = PALETTE_16[n - 90 + 8]
    else if (n >= 100 && n <= 107) state.bg = PALETTE_16[n - 100 + 8]
    i++
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function ansiToHtml(raw: string): string {
  const state: SgrState = { bold: false, dim: false, italic: false, underline: false, fg: null, bg: null }
  let html = ''
  let inSpan = false

  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI ESC sequences requires control chars
  const re = /\x1B\[([\d;]*)m|([^\x1B]+)|./g
  let m = re.exec(raw)

  while (m !== null) {
    if (m[2] !== undefined) {
      // Text chunk
      if (sgrHasStyle(state) && !inSpan) {
        html += `<span style="${sgrToStyle(state)}">`
        inSpan = true
      } else if (!sgrHasStyle(state) && inSpan) {
        html += '</span>'
        inSpan = false
      }
      html += escapeHtml(m[2])
    } else if (m[1] !== undefined) {
      // SGR sequence
      if (inSpan) {
        html += '</span>'
        inSpan = false
      }
      applySgrParams(m[1], state)
    }
    // else: stray ESC or char, skip
    m = re.exec(raw)
  }
  if (inSpan) html += '</span>'
  return html
}

// Strip everything except SGR sequences from decoded terminal output
const RE_STRIP = new RegExp(
  '\\x1B\\][^\\x07\\x1B]*(?:\\x07|\\x1B\\\\)' + // OSC sequences
    '|\\x1B\\[[0-?]*[ -/]*[@-ln-~]' + // Non-SGR CSI sequences (final byte != m)
    '|\\x1B[^\\[\\]]' + // Other single-char ESC sequences
    '|[\\x00-\\x08\\x0B-\\x1A\\x1C-\\x1F\\x7F]', // Control chars (keep ESC 0x1B, LF 0x0A, TAB 0x09)
  'g',
)

const decodeBase64 = (value: string) => {
  if (!value) return ''
  const raw = atob(value)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(RE_STRIP, '')
}

// --- Key mapping ---

const SPECIAL_KEYS: Record<string, string> = {
  Enter: '\r',
  Backspace: '\x7f',
  Tab: '\t',
  Escape: '\x1b',
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
  ArrowRight: '\x1b[C',
  ArrowLeft: '\x1b[D',
  Home: '\x1b[H',
  End: '\x1b[F',
  Delete: '\x1b[3~',
  Insert: '\x1b[2~',
  PageUp: '\x1b[5~',
  PageDown: '\x1b[6~',
}

// --- Terminal component ---

const RemoteSshTerminal: VoidComponent<{ dongleId: string }> = (props) => {
  const { authToken } = useDevicePinAuth()
  const [sessionId, setSessionId] = createSignal<string | null>(null)
  const [connected, setConnected] = createSignal(false)
  const [connecting, setConnecting] = createSignal(false)
  const [output, setOutput] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)
  const [exitCode, setExitCode] = createSignal<number | null>(null)
  const [focused, setFocused] = createSignal(false)
  const [coarsePointer, setCoarsePointer] = createSignal(false)

  let terminalRef: HTMLDivElement | undefined
  let inputRef: HTMLTextAreaElement | undefined
  let pollTimer: number | undefined
  let pollInFlight = false
  let activeUntil = 0

  let writeTimer: number | undefined
  let pendingWrite = ''
  let writeChain: Promise<void> = Promise.resolve()

  let composing = false

  const markActive = () => {
    activeUntil = Date.now() + ACTIVE_WINDOW_MS
  }

  const appendOutput = (text: string) => {
    if (!text) return
    markActive()
    const atBottom = terminalRef ? terminalRef.scrollHeight - terminalRef.scrollTop - terminalRef.clientHeight < 40 : true
    setOutput((prev) => (prev + text).slice(-MAX_BUFFER))
    if (atBottom) {
      queueMicrotask(() => {
        if (terminalRef) terminalRef.scrollTop = terminalRef.scrollHeight
      })
    }
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
      if (resp.error) throw new Error(resp.error)
      const result = resp.result
      if (!result) return
      if (!result.success) throw new Error(result.error || 'Remote SSH disabled')
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
    if (!sid || !connected() || !pendingWrite) return

    const chunk = pendingWrite
    pendingWrite = ''

    writeChain = writeChain
      .then(async () => {
        markActive()
        const resp = await remoteSshWrite(props.dongleId, sid, chunk, authToken())
        if (resp.error) throw new Error(resp.error)
        if (resp.result && !resp.result.success) throw new Error(resp.result.error || 'Remote SSH disabled')
        schedulePoll(true)
      })
      .catch(async (err) => {
        setError((err as Error).message || 'Failed to send input')
        await disconnect()
      })
      .finally(() => {
        if (connected() && pendingWrite) {
          writeTimer = window.setTimeout(flushWrites, 0)
        }
      })
  }

  const queueWrite = (data: string) => {
    if (!data || !connected()) return
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
      if (resp.error) throw new Error(resp.error)
      if (resp.result && !resp.result.success) throw new Error(resp.result.error || 'Remote SSH disabled')
      const sid = resp.result?.sessionId
      if (!sid) throw new Error('Device did not return a session id')
      setSessionId(sid)
      setConnected(true)
      markActive()
      schedulePoll(true)
      if (coarsePointer()) {
        queueMicrotask(() => inputRef?.focus())
      } else {
        terminalRef?.focus()
      }
    } catch (err) {
      const msg = (err as Error).message || 'Failed to connect'
      setError(msg === 'Remote SSH disabled' ? 'Remote SSH disabled' : msg)
      setConnected(false)
      setSessionId(null)
    } finally {
      setConnecting(false)
    }
  }

  const handlePaste = (e: ClipboardEvent) => {
    if (!connected()) return
    e.preventDefault()
    const text = (e.clipboardData?.getData('text/plain') || '').replace(/[\r\n]+$/, '')
    if (text) queueWrite(text)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!connected()) return

    // Special keys (Enter, Backspace, arrows, Home, End, Delete, etc.)
    const seq = SPECIAL_KEYS[e.key]
    if (seq) {
      // In textarea with content (composition), let native Backspace work
      if (e.key === 'Backspace' && e.target instanceof HTMLTextAreaElement && e.target.value !== '') return
      e.preventDefault()
      queueWrite(seq)
      return
    }

    // Ctrl combinations
    if (e.ctrlKey && e.key.length === 1) {
      const upper = e.key.toUpperCase()
      if (upper === 'V') return // let browser paste fire
      if (upper === 'C' && window.getSelection()?.toString()) return // let browser copy
      e.preventDefault()
      const code = upper.charCodeAt(0)
      if (code >= 64 && code <= 95) {
        queueWrite(String.fromCharCode(code - 64))
      }
      return
    }

    // Regular characters (skip if Ctrl/Meta held for browser shortcuts)
    if (!e.ctrlKey && !e.metaKey && e.key.length === 1) {
      e.preventDefault()
      queueWrite(e.key)
    }
  }

  onMount(() => {
    const mq = window.matchMedia?.('(pointer: coarse)')
    const updatePointer = () => setCoarsePointer(!!(mq?.matches || navigator.maxTouchPoints > 0))
    updatePointer()
    if (mq) {
      mq.addEventListener('change', updatePointer)
      onCleanup(() => mq.removeEventListener('change', updatePointer))
    }

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
      <div class="relative">
        <div
          ref={terminalRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onClick={() => {
            if (!coarsePointer()) return
            queueMicrotask(() => inputRef?.focus())
          }}
          onPaste={handlePaste}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          class="h-[65vh] select-text overflow-auto rounded-lg border border-outline-variant bg-black p-4 font-mono text-sm text-green-300 outline-none focus:ring-2 focus:ring-primary"
        >
          <pre
            class="whitespace-pre-wrap break-words"
            innerHTML={
              ansiToHtml(output()) +
              (connected()
                ? `<span class="${focused() ? 'term-cursor term-cursor-active' : 'term-cursor term-cursor-inactive'}">\u00a0</span>`
                : '')
            }
          />
        </div>

        <textarea
          ref={inputRef}
          aria-label="Terminal input"
          autocapitalize="off"
          autocomplete="off"
          spellcheck={false}
          inputmode="text"
          class="pointer-events-none absolute inset-0 opacity-0"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onCompositionStart={() => {
            composing = true
          }}
          onCompositionEnd={() => {
            composing = false
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onInput={(e) => {
            if (!connected()) {
              e.currentTarget.value = ''
              return
            }
            if (composing) return
            const value = e.currentTarget.value
            if (!value) return

            const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r')
            queueWrite(normalized)
            e.currentTarget.value = ''
          }}
        />
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
