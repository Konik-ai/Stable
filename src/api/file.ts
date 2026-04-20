import type {
  CancelUploadRequest,
  CancelUploadResponse,
  Files,
  Route,
  RouteInfo,
  UploadFile,
  UploadFileMetadata,
  UploadFileMetadataResponse,
  UploadFilesToUrlsRequest,
  UploadFilesToUrlsResponse,
  UploadQueueItem,
} from '~/api/types'
import { fetcher } from '.'
import { accessToken } from '~/api/auth/client'
import { API_URL } from '~/api/config'
import { makeAthenaCall } from '~/api/athena'
import { parseRouteName } from '~/api/route'

export type DownloadVideoType = 'fcamera' | 'dcamera' | 'ecamera'
export type DownloadVideoStage = 'processing' | 'downloading'
export type DownloadProgressUpdate = {
  percent: number
  etaSeconds: number | null
}

type DownloadStitchedVideoOptions = {
  signal?: AbortSignal
  onProgress?: (update: DownloadProgressUpdate) => void
  onStage?: (stage: DownloadVideoStage) => void
}

const clampProgress = (value: number): number => Math.max(0, Math.min(100, Math.round(value)))

const triggerBrowserDownload = (blob: Blob, filename: string): void => {
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Delay revoke slightly so browser download starts reliably across engines.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

export const downloadStitchedVideo = async (
  routeName: Route['fullname'],
  type: DownloadVideoType,
  opts: DownloadStitchedVideoOptions = {},
): Promise<void> => {
  const { dongleId, routeId } = parseRouteName(routeName)
  const url = `${API_URL}/connectdata/download/${dongleId}/${routeId}/${type}?sig=${accessToken() ?? ''}`
  const filename = `${dongleId}_${routeId}_${type}.mp4`
  const emitProgress = (percent: number, etaSeconds: number | null) => {
    opts.onProgress?.({ percent: clampProgress(percent), etaSeconds })
  }

  opts.onStage?.('processing')
  let estimatedProgress = 0
  const processingStartMs = performance.now()
  emitProgress(estimatedProgress, null)
  const estimateTimer = window.setInterval(() => {
    estimatedProgress = Math.min(99, estimatedProgress + (estimatedProgress < 70 ? 2 : estimatedProgress < 90 ? 1 : 0.4))
    const elapsedSeconds = (performance.now() - processingStartMs) / 1000
    const speed = elapsedSeconds > 0 ? estimatedProgress / elapsedSeconds : 0
    const etaSeconds = estimatedProgress >= 99 || speed < 0.1 ? null : Math.max(1, Math.round((100 - estimatedProgress) / speed))
    emitProgress(estimatedProgress, etaSeconds)
  }, 500)

  try {
    const response = await fetch(url, { signal: opts.signal })
    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}`)
    }
    opts.onStage?.('downloading')
    emitProgress(0, null)

    const totalBytesHeader = response.headers.get('content-length')
    const totalBytes = totalBytesHeader ? Number.parseInt(totalBytesHeader, 10) : NaN
    const knownTotal = Number.isFinite(totalBytes) && totalBytes > 0

    if (!response.body) {
      const blob = await response.blob()
      emitProgress(100, 0)
      triggerBrowserDownload(blob, filename)
      return
    }

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let receivedBytes = 0
    let fallbackProgress = 0
    const downloadStartMs = performance.now()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      chunks.push(value)
      receivedBytes += value.byteLength

      if (knownTotal) {
        const elapsedSeconds = (performance.now() - downloadStartMs) / 1000
        const bytesPerSecond = elapsedSeconds > 0 ? receivedBytes / elapsedSeconds : 0
        const remainingBytes = totalBytes - receivedBytes
        const etaSeconds = bytesPerSecond > 1 && remainingBytes > 0 ? Math.max(1, Math.round(remainingBytes / bytesPerSecond)) : 0
        emitProgress((receivedBytes / totalBytes) * 100, etaSeconds)
      } else {
        fallbackProgress = Math.min(99, fallbackProgress + 1)
        emitProgress(fallbackProgress, null)
      }
    }

    const blob = new Blob(chunks, { type: 'video/mp4' })
    emitProgress(100, 0)
    triggerBrowserDownload(blob, filename)
  } finally {
    window.clearInterval(estimateTimer)
  }
}

export const FileTypes = {
  logs: ['rlog.bz2', 'rlog.zst'],
  cameras: ['fcamera.hevc'],
  dcameras: ['dcamera.hevc'],
  ecameras: ['ecamera.hevc'],
}

export type FileType = keyof typeof FileTypes

// Higher number is lower priority
export const COMMA_CONNECT_PRIORITY = 1

// Uploads expire after 1 week if device remains offline
const EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7

export const getAlreadyUploadedFiles = (routeName: Route['fullname']): Promise<Files> => fetcher<Files>(`/v1/route/${routeName}/files`)

export const requestToUploadFiles = (dongleId: string, paths: string[], expiryDays: number = 7) =>
  fetcher<UploadFileMetadataResponse>(`/v1/${dongleId}/upload_urls/`, {
    method: 'POST',
    body: JSON.stringify({ expiry_days: expiryDays, paths }),
    headers: { 'Content-Type': 'application/json' },
  })

export const getUploadQueue = (dongleId: string) => makeAthenaCall<void, UploadQueueItem[]>(dongleId, 'listUploadQueue')

export const uploadFilesToUrls = (dongleId: string, files: UploadFile[]) =>
  makeAthenaCall<UploadFilesToUrlsRequest, UploadFilesToUrlsResponse>(
    dongleId,
    'uploadFilesToUrls',
    {
      files_data: files.map((file) => ({
        allow_cellular: false,
        fn: file.filePath,
        headers: file.headers,
        priority: COMMA_CONNECT_PRIORITY,
        url: file.url,
      })),
    },
    Math.floor(Date.now() / 1000) + EXPIRES_IN_SECONDS,
  )

export const cancelUpload = (dongleId: string, ids: string[]) =>
  makeAthenaCall<CancelUploadRequest, CancelUploadResponse>(dongleId, 'cancelUpload', { upload_id: ids })

const getFiles = async (routeName: string, types?: FileType[]) => {
  const files = await getAlreadyUploadedFiles(routeName)
  if (!types) return [...files.cameras, ...files.dcameras, ...files.ecameras, ...files.logs]
  return types.flatMap((type) => files[type])
}

const generateMissingFilePaths = (
  routeInfo: RouteInfo,
  segmentStart: number,
  segmentEnd: number,
  uploadedFiles: string[],
  types?: FileType[],
): string[] => {
  const paths: string[] = []
  for (let i = segmentStart; i <= segmentEnd; i++) {
    const fileTypes = types ? types.flatMap((type) => FileTypes[type]) : Object.values(FileTypes).flat()
    for (const fileName of fileTypes) {
      const key = [routeInfo.dongleId, routeInfo.routeId, i, fileName].join('/')
      if (!uploadedFiles.find((path) => path.includes(key))) {
        paths.push(`${routeInfo.routeId}--${i}/${fileName}`)
      }
    }
  }
  return paths
}

const prepareUploadRequests = (paths: string[], presignedUrls: UploadFileMetadata[]): UploadFile[] =>
  paths.map((path, i) => ({ filePath: path, ...presignedUrls[i] }))

export const uploadAllSegments = (routeName: string, totalSegments: number, types?: FileType[]) =>
  uploadSegments(routeName, 0, totalSegments - 1, types)

export const uploadSegments = async (routeName: string, segmentStart: number, segmentEnd: number, types?: FileType[]) => {
  const routeInfo = parseRouteName(routeName)
  const alreadyUploadedFiles = await getFiles(routeName, types)
  const paths = generateMissingFilePaths(routeInfo, segmentStart, segmentEnd, alreadyUploadedFiles, types)
  const pathPresignedUrls = await requestToUploadFiles(routeInfo.dongleId, paths)
  const athenaRequests = prepareUploadRequests(paths, pathPresignedUrls)
  if (athenaRequests.length === 0) return []
  return await uploadFilesToUrls(routeInfo.dongleId, athenaRequests)
}
