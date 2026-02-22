import { makeAthenaCall } from '~/api/athena'
import { fetcher } from '.'

export type NavigationDestinationParams = {
  latitude: number
  longitude: number
  place_name: string
  place_details: string
}

type NavigationSetDestinationResponse = {
  success: boolean
  saved_next: boolean
}

const NAV_DESTINATION_EXPIRY_SECONDS = 7 * 24 * 60 * 60

const buildAthenaExpiry = () => Math.floor(Date.now() / 1000) + NAV_DESTINATION_EXPIRY_SECONDS

// Prefer the backend navigation endpoint (same path used by Konik-Stable).
// Fall back to direct Athena JSON-RPC for deployments missing the endpoint.
export const setDestination = async (dongleId: string, params: NavigationDestinationParams): Promise<NavigationSetDestinationResponse> => {
  try {
    return await fetcher<NavigationSetDestinationResponse>(`/v1/navigation/${dongleId}/set_destination`, {
      method: 'POST',
      body: JSON.stringify(params),
      headers: {
        'Content-Type': 'application/json',
      },
    })
  } catch (apiErr) {
    const athenaResp = await makeAthenaCall<NavigationDestinationParams, { success: number }>(
      dongleId,
      'setNavDestination',
      params,
      buildAthenaExpiry(),
    )

    if (athenaResp.error) {
      throw apiErr
    }

    return { success: true, saved_next: athenaResp.queued }
  }
}
