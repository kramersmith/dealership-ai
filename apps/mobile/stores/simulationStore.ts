import { create } from 'zustand'
import type { Scenario } from '@/lib/types'
import { api } from '@/lib/api'

interface SimulationState {
  scenarios: Scenario[]
  isLoading: boolean

  loadScenarios: () => Promise<void>
  startSimulation: (scenarioId: string) => Promise<string> // returns session id
}

export const useSimulationStore = create<SimulationState>((set) => ({
  scenarios: [],
  isLoading: false,

  loadScenarios: async () => {
    set({ isLoading: true })
    try {
      const scenarios = await api.getScenarios()
      set({ scenarios, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  startSimulation: async (scenarioId) => {
    const session = await api.startSimulation(scenarioId)
    return session.id
  },
}))
