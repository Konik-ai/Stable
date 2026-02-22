import type { AthenaCallResponse, BackendAthenaCallResponse, BackendAthenaCallResponseError } from '~/api/types'
import { fetcher } from '.'
import { ATHENA_URL } from './config'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const normalizeAthenaError = (err: unknown): string => {
  if (typeof err === 'string') return err

  if (!isRecord(err)) return 'Athena call failed'

  // `fetcher()` throws `Error(message, { cause })`.
  const cause = err.cause
  if (isRecord(cause)) {
    if (typeof cause.error === 'string') return cause.error
    if (typeof cause.description === 'string') return cause.description
    if (typeof cause.message === 'string') return cause.message
  }

  if (typeof err.message === 'string' && err.message) return err.message
  if (typeof err.description === 'string') return err.description
  if (typeof err.error === 'string') return err.error

  try {
    return JSON.stringify(err)
  } catch {
    return 'Athena call failed'
  }
}

export const getNetworkMetered = (dongleId: string) => makeAthenaCall<void, boolean>(dongleId, 'getNetworkMetered')

export const setRouteViewed = (dongleId: string, route: string) =>
  makeAthenaCall<{ route: string }, void>(dongleId, 'setRouteViewed', { route })

export type NavDestinationParams = {
  latitude?: number
  longitude?: number
  place_name?: string
  place_details?: string
}

export const setNavDestination = (dongleId: string, params: NavDestinationParams) =>
  makeAthenaCall<NavDestinationParams, { success: number }>(dongleId, 'setNavDestination', params)

export const takeSnapshot = (dongleId: string) =>
  makeAthenaCall<
    void,
    {
      jpegFront?: string
      jpegBack?: string
    }
  >(dongleId, 'takeSnapshot')

export const getSdp = (dongleId: string, authToken?: string) =>
  makeAthenaCall<{ authToken?: string }, { type?: string; sdp?: string; error?: string }>(dongleId, 'getSdp', { authToken })

export const setSdpAnswer = (dongleId: string, answer: unknown, authToken?: string) =>
  makeAthenaCall<{ answer: unknown; authToken?: string }, void>(dongleId, 'setSdpAnswer', { answer, authToken })

export const getIce = (dongleId: string, authToken?: string) =>
  makeAthenaCall<{ authToken?: string }, Array<{ candidate: string; sdpMid?: string; sdpMLineIndex?: number }> | { error: boolean }>(
    dongleId,
    'getIce',
    { authToken },
  )

export const remoteSshStart = (dongleId: string, cols: number, rows: number, authToken?: string) =>
  makeAthenaCall<{ cols: number; rows: number; authToken?: string }, { success: boolean; sessionId?: string; error?: string }>(
    dongleId,
    'remoteSshStart',
    {
      cols,
      rows,
      authToken,
    },
  )

export const remoteSshWrite = (dongleId: string, sessionId: string, data: string, authToken?: string) =>
  makeAthenaCall<{ sessionId: string; data: string; authToken?: string }, { success: boolean; error?: string }>(
    dongleId,
    'remoteSshWrite',
    {
      sessionId,
      data,
      authToken,
    },
  )

export const remoteSshRead = (dongleId: string, sessionId: string, maxBytes: number = 65536, authToken?: string) =>
  makeAthenaCall<
    { sessionId: string; maxBytes: number; authToken?: string },
    { success: boolean; data: string; closed: boolean; exitCode: number | null; error?: string }
  >(dongleId, 'remoteSshRead', { sessionId, maxBytes, authToken })

export const remoteSshResize = (dongleId: string, sessionId: string, cols: number, rows: number, authToken?: string) =>
  makeAthenaCall<{ sessionId: string; cols: number; rows: number; authToken?: string }, { success: boolean; error?: string }>(
    dongleId,
    'remoteSshResize',
    {
      sessionId,
      cols,
      rows,
      authToken,
    },
  )

export const remoteSshStop = (dongleId: string, sessionId: string, authToken?: string) =>
  makeAthenaCall<{ sessionId: string; authToken?: string }, { success: boolean; error?: string }>(dongleId, 'remoteSshStop', {
    sessionId,
    authToken,
  })

export const remotePinStatus = (dongleId: string) =>
  makeAthenaCall<void, { set: boolean; locked: boolean; lockRemainingS: number }>(dongleId, 'remotePinStatus')

export const remotePinVerify = (dongleId: string, pin: string) =>
  makeAthenaCall<{ pin: string }, { success: boolean; token?: string; expiresInS?: number; error?: string; lockRemainingS?: number }>(
    dongleId,
    'remotePinVerify',
    { pin },
  )

export const remotePinSet = (dongleId: string, pin: string) =>
  makeAthenaCall<{ pin: string }, { success: boolean }>(dongleId, 'remotePinSet', { pin })

export const remotePinChange = (dongleId: string, oldPin: string, newPin: string) =>
  makeAthenaCall<{ oldPin: string; newPin: string }, { success: boolean }>(dongleId, 'remotePinChange', { oldPin, newPin })

export const remotePinClear = (dongleId: string, force: boolean = false, pin?: string) =>
  makeAthenaCall<{ force: boolean; pin?: string }, { success: boolean }>(dongleId, 'remotePinClear', { force, pin })

export const makeAthenaCall = async <REQ, RES>(
  dongleId: string,
  method: string,
  params?: REQ,
  expiry?: number,
): Promise<AthenaCallResponse<RES>> => {
  let res: BackendAthenaCallResponse<RES> | BackendAthenaCallResponseError
  try {
    res = await fetcher<BackendAthenaCallResponse<RES> | BackendAthenaCallResponseError>(
      `/${dongleId}`,
      {
        method: 'POST',
        body: JSON.stringify({ id: 0, jsonrpc: '2.0', method, params, expiry }),
        headers: { 'Content-Type': 'application/json' },
      },
      ATHENA_URL,
    )
  } catch (err) {
    return { queued: false, error: normalizeAthenaError(err), result: undefined }
  }
  if ('error' in res) {
    return { queued: false, error: normalizeAthenaError(res.error), result: undefined }
  }
  if (typeof res.result === 'string' && res.result === 'Device offline, message queued') {
    return { queued: true, error: undefined, result: undefined }
  }
  return { queued: false, error: undefined, result: res.result as RES }
}
