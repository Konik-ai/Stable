import { accessToken } from './auth/client'
import { API_URL } from './config'

const normalizeDescription = (desc: unknown): string => {
  if (typeof desc === 'string') return desc
  if (desc && typeof desc === 'object') {
    const anyDesc = desc as any
    if (typeof anyDesc.message === 'string') return anyDesc.message
    try {
      return JSON.stringify(desc)
    } catch {
      return 'Server error'
    }
  }
  return 'Server error'
}

export async function fetcher<T>(endpoint: string, init?: RequestInit, apiUrl: string = API_URL): Promise<T> {
  const req = new Request(`${apiUrl}${endpoint}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `JWT ${accessToken()}`,
    },
  })
  const res = await fetch(req)
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${req.method} ${req.url} ${res.status}`, { cause: res })
  }
  // biome-ignore lint/suspicious/noImplicitAnyLet: TODO: validate server response
  let json
  try {
    json = await JSON.parse(text)
  } catch (err) {
    throw new Error('Failed to parse response from server', { cause: err })
  }

  // JSON-RPC responses (Athena) may include an `error` field; let the caller interpret it.
  if (json && typeof json === 'object' && (json as any).jsonrpc) {
    return json
  }

  // Many endpoints use `{ error: true, description: string }`, while others use `{ error: string }`.
  // Only treat the boolean form as a transport-level error here; callers handle string errors.
  if (json && typeof json === 'object' && 'error' in (json as any)) {
    const err = (json as any).error
    if (err === true) {
      const desc = 'description' in (json as any) ? normalizeDescription((json as any).description) : 'Server error'
      throw new Error(desc.startsWith('Server error') ? desc : `Server error: ${desc}`, { cause: json })
    }
  }
  return json
}
