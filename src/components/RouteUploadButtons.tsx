import { createEffect, createSignal, on, type VoidComponent } from 'solid-js'
import { createStore } from 'solid-js/store'
import clsx from 'clsx'

import Icon, { type IconName } from '~/components/material/Icon'
import Button from './material/Button'
import {
  downloadStitchedVideo,
  getAlreadyUploadedFiles,
  uploadAllSegments,
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
}

const UploadButton: VoidComponent<UploadButtonProps> = (props) => {
  const icon = () => props.icon
  const state = () => props.state
  const disabled = () => state() === 'loading' || state() === 'success'

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
      <span class="flex items-center gap-1 font-mono">{props.text}</span>
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
  const [abortController, setAbortController] = createSignal(new AbortController())

  createEffect(
    on(
      () => props.route,
      () => {
        abortController().abort()
        setAbortController(new AbortController())
        setUploadStore(BUTTON_TYPES, 'idle')
        setDownloadStore(['fcamera', 'dcamera', 'ecamera'], 'idle')
      },
    ),
  )

  const handleDownload = async (video: DownloadVideoType) => {
    if (!props.route) return
    const { fullname, maxqlog } = props.route
    const totalSegments = maxqlog + 1
    const { signal } = abortController()

    setDownloadStore(video, 'loading')
    try {
      const files = await getAlreadyUploadedFiles(fullname)
      if (signal.aborted) return
      const available =
        video === 'fcamera' ? files.cameras : video === 'dcamera' ? files.dcameras : files.ecameras
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
      downloadStitchedVideo(fullname, video)
      setDownloadStore(video, 'idle')
    } catch (err) {
      if (signal.aborted) return
      console.error('Failed to download', err)
      setDownloadStore(video, 'error')
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
            text={`Download ${btn.text}`}
            icon="download"
            state={downloadStore[btn.video]}
            onClick={() => handleDownload(btn.video)}
          />
        ))}
      </div>
    </div>
  )
}

export default RouteUploadButtons
