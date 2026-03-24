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
    } catch (err) {
      console.error(
        '[simulationStore] loadScenarios failed:',
        err instanceof Error ? err.message : err
      )
      set({ isLoading: false })
    }
  },

  startSimulation: async (scenarioId) => {
    try {
      const session = await api.startSimulation(scenarioId)
      return session.id
    } catch (err) {
      console.error(
        '[simulationStore] startSimulation failed:',
        err instanceof Error ? err.message : err
      )
      throw err
    }
  },
}))
