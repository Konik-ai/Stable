import { createSignal } from 'solid-js'

import { MAP_STYLE_OPTIONS, type BaseMapStyleKey } from './config'
import type { MapStyleChoice } from './index'

const STORAGE_KEY = 'map-style-preference'

type StoredKey = BaseMapStyleKey | 'theme'

const isValidKey = (value: string | null): value is StoredKey => {
  if (!value) return false
  if (value === 'theme') return true
  return MAP_STYLE_OPTIONS.some((opt) => opt.key === value)
}

const readInitialKey = (): StoredKey => {
  if (typeof localStorage === 'undefined') return 'theme'
  const stored = localStorage.getItem(STORAGE_KEY)
  return isValidKey(stored) ? stored : 'theme'
}

const [mapStyleChoice, setMapStyleChoice] = createSignal<StoredKey>(readInitialKey())

const persistChoice = (value: StoredKey) => {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, value)
}

export const mapStyleOptions = [{ key: 'theme', label: 'Current Theme' } as const, ...MAP_STYLE_OPTIONS]

export const useMapStylePreference = () => {
  const setPreference = (value: MapStyleChoice) => {
    setMapStyleChoice(value)
    persistChoice(value)
  }

  return [mapStyleChoice, setPreference] as const
}

export const getCurrentMapStyleChoice = (): StoredKey => mapStyleChoice()
