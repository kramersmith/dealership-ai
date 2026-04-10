import { create } from 'zustand'
import { api } from '@/lib/api'
import type { InsightsUpdateMode, UserSettings } from '@/lib/types'

const DEFAULT_SETTINGS: UserSettings = {
  insightsUpdateMode: 'live',
}

interface UserSettingsState {
  insightsUpdateMode: InsightsUpdateMode
  isLoading: boolean
  error: string | null
  hydrateFromAuthPayload: (settings: UserSettings) => void
  refreshFromServer: () => Promise<void>
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>
  reset: () => void
}

export const useUserSettingsStore = create<UserSettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  isLoading: false,
  error: null,

  hydrateFromAuthPayload: (settings) => {
    set({
      insightsUpdateMode: settings.insightsUpdateMode,
      error: null,
    })
  },

  refreshFromServer: async () => {
    set({ isLoading: true, error: null })
    try {
      const settings = await api.getUserSettings()
      set({
        insightsUpdateMode: settings.insightsUpdateMode,
        isLoading: false,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load settings'
      set({ isLoading: false, error: message })
      throw err
    }
  },

  updateSettings: async (patch) => {
    const previous = {
      insightsUpdateMode: get().insightsUpdateMode,
    }
    set({
      ...(patch.insightsUpdateMode ? { insightsUpdateMode: patch.insightsUpdateMode } : null),
      isLoading: true,
      error: null,
    })
    try {
      const settings = await api.updateUserSettings(patch)
      set({
        insightsUpdateMode: settings.insightsUpdateMode,
        isLoading: false,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update settings'
      set({
        insightsUpdateMode: previous.insightsUpdateMode,
        isLoading: false,
        error: message,
      })
      throw err
    }
  },

  reset: () => {
    set({ ...DEFAULT_SETTINGS, isLoading: false, error: null })
  },
}))
