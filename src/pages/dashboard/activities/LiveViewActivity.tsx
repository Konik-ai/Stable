import { createEffect, createSignal, For, onCleanup, onMount, Show, type VoidComponent } from 'solid-js'

import { getSdp, setSdpAnswer } from '~/api/athena'
import Button from '~/components/material/Button'
import IconButton from '~/components/material/IconButton'
import TopAppBar from '~/components/material/TopAppBar'

type StreamItem = {
  label: string
  stream: MediaStream
  paused?: boolean
}

const STREAM_LABELS: Record<string, string> = {
  wideRoad: 'Exterior',
  driver: 'Interior',
}

const INACTIVITY_TIMEOUT_MS = 30_000

const ICE_SERVERS: RTCIceServer[] = [
  {
    urls: 'turn:85.190.241.173:3478',
    username: 'testuser',
    credential: 'testpass',
  },
  {
    urls: ['stun:85.190.241.173:3478', 'stun:stun.l.google.com:19302'],
  },
]

const LiveViewActivity: VoidComponent<{ dongleId: string }> = (props) => {
  const [rtcConnection, setRtcConnection] = createSignal<RTCPeerConnection | null>(null)
  const [_dataChannel, setDataChannel] = createSignal<RTCDataChannel | null>(null)
  const [dataChannelReady, setDataChannelReady] = createSignal(false)
  const [streams, setStreams] = createSignal<StreamItem[]>([])
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [status, setStatus] = createSignal<string | null>(null)

  let inactivityTimer: number | undefined

  const disconnect = () => {
    const connection = rtcConnection()
    if (connection) {
      connection.close()
    }
    setRtcConnection(null)
    setDataChannel(null)
    setDataChannelReady(false)
    setStreams([])
  }

  const fetchDeviceSdpOffer = async () => {
    const resp = await getSdp(props.dongleId)
    if (resp.error) {
      throw new Error(resp.error)
    }
    return resp.result
  }

  const setupRTCConnection = async () => {
    if (!props.dongleId) return
    disconnect()
    setError(null)
    setStatus('Starting Live View...')
    setLoading(true)

    try {
      await setSdpAnswer(props.dongleId, { type: 'start' })
      const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceTransportPolicy: 'all' })

      connection.ontrack = (event) => {
        const label = event.track.label.split(':')[0] || event.track.label
        if (label === 'road') {
          return
        }
        const newStream = new MediaStream([event.track])
        setStreams((prev) => {
          const existing = prev.find((item) => item.label === label)
          if (existing) {
            return prev.map((item) => (item.label === label ? { ...item, stream: newStream } : item))
          }
          return [...prev, { label, stream: newStream }]
        })
      }

      connection.onicecandidate = (event) => {
        if (event.candidate) {
          void setSdpAnswer(props.dongleId, { type: 'candidate', candidate: event.candidate })
        }
      }

      connection.oniceconnectionstatechange = () => {
        if (['failed', 'disconnected'].includes(connection.iceConnectionState)) {
          setError('Connection failed')
        }
      }

      connection.ondatachannel = (event) => {
        const channel = event.channel
        setDataChannel(channel)
        channel.onopen = () => setDataChannelReady(true)
        channel.onclose = () => setDataChannelReady(false)
        channel.onmessage = (msg) => {
          try {
            const message = JSON.parse(msg.data)
            if (message.tmuxCapture) {
              setStatus('tmux capture received')
              return
            }
            if (message.trackState) {
              setStreams((prev) =>
                prev.map((stream) => ({
                  ...stream,
                  paused: message.trackState[stream.label] ?? stream.paused,
                })),
              )
              return
            }
          } catch (_err) {
            setError('Failed to parse data channel message.')
          }
        }
      }

      setStatus('Connecting to device...')
      const offer = await fetchDeviceSdpOffer()
      if (!offer || offer.type !== 'offer') {
        const reason = offer?.error ? String(offer.error) : 'Failed to connect to the device.'
        setError(reason)
        connection.close()
        return
      }

      await connection.setRemoteDescription(new RTCSessionDescription(offer))

      const answer = await connection.createAnswer()
      await connection.setLocalDescription(answer)
      await new Promise<void>((resolve) => {
        if (connection.iceGatheringState === 'complete') {
          resolve()
          return
        }
        connection.addEventListener('icegatheringstatechange', () => {
          if (connection.iceGatheringState === 'complete') {
            resolve()
          }
        })
      })

      await setSdpAnswer(props.dongleId, answer)
      setRtcConnection(connection)
      setLoading(false)
      setStatus(null)
    } catch (err) {
      setError((err as Error).message || 'Failed to start Live View session.')
      disconnect()
    } finally {
      setLoading(false)
    }
  }

  const toggleConnection = () => {
    if (dataChannelReady()) {
      disconnect()
      return
    }
    void setupRTCConnection()
  }

  const resetInactivityTimer = () => {
    if (inactivityTimer !== undefined) {
      window.clearTimeout(inactivityTimer)
    }
    inactivityTimer = window.setTimeout(() => {
      if (dataChannelReady()) {
        disconnect()
      }
    }, INACTIVITY_TIMEOUT_MS)
  }

  createEffect(() => {
    if (!dataChannelReady()) {
      if (inactivityTimer !== undefined) {
        window.clearTimeout(inactivityTimer)
      }
      return
    }
    const handler = () => resetInactivityTimer()
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll']
    for (const eventName of events) {
      window.addEventListener(eventName, handler, { passive: true })
    }
    resetInactivityTimer()
    onCleanup(() => {
      for (const eventName of events) {
        window.removeEventListener(eventName, handler)
      }
      if (inactivityTimer !== undefined) {
        window.clearTimeout(inactivityTimer)
      }
    })
  })

  onMount(() => {
    const handleBeforeUnload = () => disconnect()
    window.addEventListener('beforeunload', handleBeforeUnload)
    onCleanup(() => window.removeEventListener('beforeunload', handleBeforeUnload))
  })

  onCleanup(() => {
    disconnect()
  })

  return (
    <>
      <TopAppBar component="h2" leading={<IconButton class="md:hidden" name="arrow_back" href={`/${props.dongleId}`} />}>
        Live View
      </TopAppBar>
      <div class="flex flex-col gap-6 px-4 pb-10">
        <div class="rounded-lg bg-surface-container-low p-6 shadow-lg">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="flex flex-col gap-1">
              <span class="text-lg font-medium text-on-surface">Stream a camera view from your device</span>
              <span class="text-sm text-on-surface-variant">Live video updates as long as your device stays online.</span>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <Button color={dataChannelReady() ? 'secondary' : 'primary'} loading={loading()} onClick={toggleConnection}>
                {dataChannelReady() ? 'Disconnect' : 'Connect'}
              </Button>
              <Show when={status()}>
                <span class="rounded-full bg-surface-container-high px-3 py-1 text-xs text-on-surface-variant">{status()}</span>
              </Show>
            </div>
          </div>
        </div>
        <Show when={error()}>
          <div class="rounded-md bg-surface-container-high p-3 text-sm text-error">{error()}</div>
        </Show>
        <div class="grid gap-6 md:grid-cols-2">
          <For each={streams()}>
            {(item) => (
              <div class="rounded-lg bg-surface-container-low p-5 shadow-md">
                <div class="mb-3 flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <div class="h-2 w-2 rounded-full bg-emerald-400" />
                    <span class="text-sm text-on-surface-variant">{STREAM_LABELS[item.label] ?? item.label}</span>
                  </div>
                </div>
                <video
                  class="aspect-video w-full rounded-lg bg-black/70 shadow-inner"
                  autoplay
                  muted
                  playsinline
                  ref={(el) => {
                    if (el.srcObject !== item.stream) {
                      el.srcObject = item.stream
                    }
                  }}
                />
              </div>
            )}
          </For>
        </div>
      </div>
    </>
  )
}

export default LiveViewActivity
