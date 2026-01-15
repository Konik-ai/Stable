export const MAPBOX_USERNAME = 'commaai'

export const MAPBOX_LIGHT_STYLE_ID = 'clcl7mnu2000214s2zgcdly6e'
export const MAPBOX_DARK_STYLE_ID = 'clcgvbi4f000q15t6o2s8gys3'
export const MAPBOX_SATELLITE_STYLE_ID = 'satellite-streets-v12'

export type BaseMapStyleKey = 'light' | 'dark' | 'satellite'

export type MapStyleOption = {
  key: BaseMapStyleKey
  label: string
  owner: string
  id: string
}

export const MAP_STYLE_OPTIONS: MapStyleOption[] = [
  { key: 'light', label: 'Light', owner: MAPBOX_USERNAME, id: MAPBOX_LIGHT_STYLE_ID },
  { key: 'dark', label: 'Dark', owner: MAPBOX_USERNAME, id: MAPBOX_DARK_STYLE_ID },
  // mapbox-owned style keeps satellite tiles available even if custom styles change
  { key: 'satellite', label: 'Satellite', owner: 'mapbox', id: MAPBOX_SATELLITE_STYLE_ID },
]

// TODO: validate env or throw error
export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string
