import { createEffect, createSignal, on, type VoidComponent } from 'solid-js'
import { createStore } from 'solid-js/store'
import clsx from 'clsx'

import Icon, { type IconName } from '~/components/material/Icon'
import Button from './material/Button'
import {
  downloadStitchedVideo,
  getAlreadyUploadedFiles,
  uploadAllSegments,
  type DownloadProgressUpdate,
  type DownloadVideoStage,
  type DownloadVideoType,
  type FileType,
} from '~/api/file'
import { USERADMIN_URL } from '~/api/config'
import type { Route } from '~/api/types'

const BUTTON_TYPES = ['road', 'driver', 'logs', 'route'] as const
type ButtonType = (typeof BUTTON_TYPES)[number]
type ButtonState = 'idle' | 'loading' | 'success' | 'error'

const BUTTON_TO_FILE_TYPES = {
  road: ['cameras', 'ecameras'],
  driver: ['dcameras'],
  logs: ['logs'],
} as const

const DOWNLOAD_BUTTONS: { type: 'road' | 'driver'; video: DownloadVideoType; text: string; icon: IconName }[] = [
  { type: 'road', video: 'fcamera', text: 'Road', icon: 'videocam' },
  { type: 'driver', video: 'dcamera', text: 'Driver', icon: 'person' },
]

interface UploadButtonProps {
  state: ButtonState
  onClick: () => void
  icon: IconName
  text: string
  progress?: number
  etaSeconds?: number | null
}

const formatEta = (etaSeconds: number | null | undefined): string | null => {
  if (etaSeconds == null || etaSeconds <= 0) return null
  if (etaSeconds < 60) return `${etaSeconds}s`
  if (etaSeconds < 3600) {
    const minutes = Math.floor(etaSeconds / 60)
    const seconds = etaSeconds % 60
    return `${minutes}m ${seconds}s`
  }
  const hours = Math.floor(etaSeconds / 3600)
  const minutes = Math.floor((etaSeconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

const UploadButton: VoidComponent<UploadButtonProps> = (props) => {
  const icon = () => props.icon
  const state = () => props.state
  const disabled = () => state() === 'loading' || state() === 'success'
  const etaText = () => formatEta(props.etaSeconds)

  const handleUpload = () => {
    if (disabled()) return
    props.onClick?.()
  }

  const stateToIcon: Record<ButtonState, IconName> = {
    idle: icon(),
    loading: 'progress_activity',
    success: 'check',
    error: 'error',
  }

  return (
    <Button
      onClick={() => handleUpload()}
      class="px-2 md:px-3"
      disabled={disabled()}
      leading={<Icon class={clsx(state() === 'loading' && 'animate-spin')} name={stateToIcon[state()]} size="20" />}
      color="primary"
    >
      <span class="flex items-center gap-1 font-mono">
        {props.state === 'loading' && typeof props.progress === 'number'
          ? `${props.text} ${Math.round(props.progress)}%${etaText() ? ` • ETA ${etaText()}` : ''}`
          : props.text}
      </span>
    </Button>
  )
}

interface RouteUploadButtonsProps {
  route: Route | undefined
}

const RouteUploadButtons: VoidComponent<RouteUploadButtonsProps> = (props) => {
  const [uploadStore, setUploadStore] = createStore<Record<ButtonType, ButtonState>>({
    road: 'idle',
    driver: 'idle',
    logs: 'idle',
    route: 'idle',
  })
  const [downloadStore, setDownloadStore] = createStore<Record<DownloadVideoType, ButtonState>>({
    fcamera: 'idle',
    dcamera: 'idle',
    ecamera: 'idle',
  })
  const [downloadProgressStore, setDownloadProgressStore] = createStore<Record<DownloadVideoType, number>>({
    fcamera: 0,
    dcamera: 0,
    ecamera: 0,
  })
  const [downloadEtaStore, setDownloadEtaStore] = createStore<Record<DownloadVideoType, number | null>>({
    fcamera: null,
    dcamera: null,
    ecamera: null,
  })
  const [downloadStageStore, setDownloadStageStore] = createStore<Record<DownloadVideoType, DownloadVideoStage>>({
    fcamera: 'processing',
    dcamera: 'processing',
    ecamera: 'processing',
  })
  const [abortController, setAbortController] = createSignal(new AbortController())

  createEffect(
    on(
      () => props.route,
      () => {
        abortController().abort()
        setAbortController(new AbortController())
        setUploadStore(BUTTON_TYPES, 'idle')
        setDownloadStore(['fcamera', 'dcamera', 'ecamera'], 'idle')
        setDownloadProgressStore(['fcamera', 'dcamera', 'ecamera'], 0)
        setDownloadEtaStore(['fcamera', 'dcamera', 'ecamera'], null)
        setDownloadStageStore(['fcamera', 'dcamera', 'ecamera'], 'processing')
      },
    ),
  )

  const handleDownload = async (video: DownloadVideoType) => {
    if (!props.route) return
    const { fullname, maxqlog } = props.route
    const totalSegments = maxqlog + 1
    const { signal } = abortController()

    setDownloadStore(video, 'loading')
    setDownloadProgressStore(video, 0)
    setDownloadEtaStore(video, null)
    setDownloadStageStore(video, 'processing')
    try {
      const files = await getAlreadyUploadedFiles(fullname)
      if (signal.aborted) return
      const available = video === 'fcamera' ? files.cameras : video === 'dcamera' ? files.dcameras : files.ecameras
      const present = new Set<number>()
      for (const url of available) {
        const m = url.match(/\/(\d+)\/[^/?]+\.hevc/)
        if (m) present.add(parseInt(m[1], 10))
      }
      const missing: number[] = []
      for (let i = 0; i < totalSegments; i++) {
        if (!present.has(i)) missing.push(i)
      }
      if (missing.length > 0) {
        setDownloadStore(video, 'error')
        setDownloadProgressStore(video, 0)
        setDownloadEtaStore(video, null)
        setDownloadStageStore(video, 'processing')
        const label = video === 'fcamera' ? 'road' : video === 'dcamera' ? 'driver' : 'wide road'
        const useradminUrl = `${USERADMIN_URL}/?onebox=${fullname}`
        const openUseradmin = confirm(
          `Cannot download: ${missing.length} of ${totalSegments} ${label} camera segments are missing.\n\n` +
            `Upload all files first, or open useradmin to download individual segments.\n\n` +
            `Click OK to open useradmin, Cancel to dismiss.`,
        )
        if (openUseradmin) window.open(useradminUrl, '_blank', 'noopener')
        return
      }
      await downloadStitchedVideo(fullname, video, {
        signal,
        onProgress: ({ percent, etaSeconds }: DownloadProgressUpdate) => {
          if (signal.aborted) return
          setDownloadProgressStore(video, percent)
          setDownloadEtaStore(video, etaSeconds)
        },
        onStage: (stage) => {
          if (signal.aborted) return
          setDownloadStageStore(video, stage)
          if (stage === 'downloading') {
            // Start download percentage from zero once streaming begins.
            setDownloadProgressStore(video, 0)
          }
        },
      })
      if (signal.aborted) return
      setDownloadProgressStore(video, 100)
      setDownloadEtaStore(video, 0)
      setDownloadStore(video, 'success')
      window.setTimeout(() => {
        if (signal.aborted) return
        setDownloadStore(video, 'idle')
        setDownloadProgressStore(video, 0)
        setDownloadEtaStore(video, null)
        setDownloadStageStore(video, 'processing')
      }, 1500)
    } catch (err) {
      if (signal.aborted) return
      console.error('Failed to download', err)
      setDownloadStore(video, 'error')
      setDownloadProgressStore(video, 0)
      setDownloadEtaStore(video, null)
      setDownloadStageStore(video, 'processing')
    }
  }

  const handleUpload = async (type: ButtonType) => {
    if (!props.route) return
    const { fullname, maxqlog } = props.route
    const { signal } = abortController()

    const updateButtonStates = (types: readonly ButtonType[], state: ButtonState) => {
      if (signal.aborted) return
      setUploadStore(types, state)
    }

    const uploadButtonTypes: ButtonType[] = [type]
    let uploadFileTypes: FileType[] = []
    for (const check of type === 'route' ? (['road', 'driver', 'logs'] as const) : [type]) {
      const state = uploadStore[check]
      if (state === 'loading' || state === 'success') continue
      uploadButtonTypes.push(check)
      uploadFileTypes = uploadFileTypes.concat(BUTTON_TO_FILE_TYPES[check])
    }

    updateButtonStates(uploadButtonTypes, 'loading')
    try {
      await uploadAllSegments(fullname, maxqlog + 1, uploadFileTypes)
      updateButtonStates(uploadButtonTypes, 'success')
    } catch (err) {
      console.error('Failed to upload', err)
      updateButtonStates(uploadButtonTypes, 'error')
    }
  }

  return (
    <div class="flex flex-col gap-3 rounded-b-md m-5">
      <div class="grid grid-cols-2 gap-3 w-full lg:grid-cols-4">
        <UploadButton text="Road" icon="videocam" state={uploadStore.road} onClick={() => handleUpload('road')} />
        <UploadButton text="Driver" icon="person" state={uploadStore.driver} onClick={() => handleUpload('driver')} />
        <UploadButton text="Logs" icon="description" state={uploadStore.logs} onClick={() => handleUpload('logs')} />
        <UploadButton text="All" icon="upload" state={uploadStore.route} onClick={() => handleUpload('route')} />
      </div>
      <div class="grid grid-cols-2 gap-3 w-full">
        {DOWNLOAD_BUTTONS.map((btn) => (
          <UploadButton
            text={
              downloadStore[btn.video] === 'loading'
                ? downloadStageStore[btn.video] === 'downloading'
                  ? 'Downloading'
                  : 'Processing'
                : `Download ${btn.text}`
            }
            icon="download"
            state={downloadStore[btn.video]}
            progress={downloadProgressStore[btn.video]}
            etaSeconds={downloadEtaStore[btn.video]}
            onClick={() => handleDownload(btn.video)}
          />
        ))}
      </div>
    </div>
  )
}

export default RouteUploadButtons
