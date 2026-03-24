import { create } from 'zustand'
import { api } from '@/lib/api'
import { setAuthToken } from '@/lib/apiClient'

interface AuthState {
  userId: string | null
  role: 'buyer' | 'dealer' | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null

  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, role: string) => Promise<void>
  logout: () => void
  setRole: (role: 'buyer' | 'dealer') => void
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  userId: null,
  role: 'buyer',
  isAuthenticated: false,
  isLoading: false,
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null })
    try {
      const result = await api.login(email, password)
      set({
        userId: result.userId,
        role: result.role as 'buyer' | 'dealer',
        isAuthenticated: true,
        isLoading: false,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed'
      console.error('[authStore] login failed:', message)
      set({ isLoading: false, error: message })
      throw err
    }
  },

  register: async (email, password, role) => {
    set({ isLoading: true, error: null })
    try {
      const result = await api.register(email, password, role)
      set({
        userId: result.userId,
        role: role as 'buyer' | 'dealer',
        isAuthenticated: true,
        isLoading: false,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed'
      console.error('[authStore] register failed:', message)
      set({ isLoading: false, error: message })
      throw err
    }
  },

  logout: () => {
    setAuthToken(null)
    set({ userId: null, role: null, isAuthenticated: false, error: null })
  },

  setRole: (role) => {
    if (__DEV__) {
      set({ role })
    }
  },

  clearError: () => {
    set({ error: null })
  },
}))
