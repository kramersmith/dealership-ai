import { create } from 'zustand'
import { api } from '@/lib/api'

interface AuthState {
  userId: string | null
  role: 'buyer' | 'dealer' | null
  isAuthenticated: boolean
  isLoading: boolean

  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, role: string) => Promise<void>
  logout: () => void
  setRole: (role: 'buyer' | 'dealer') => void
}

export const useAuthStore = create<AuthState>((set) => ({
  userId: null,
  role: 'buyer',
  isAuthenticated: true, // default to true for mock development
  isLoading: false,

  login: async (email, password) => {
    set({ isLoading: true })
    try {
      const result = await api.login(email, password)
      set({
        userId: result.userId,
        role: result.role as 'buyer' | 'dealer',
        isAuthenticated: true,
        isLoading: false,
      })
    } catch {
      set({ isLoading: false })
    }
  },

  register: async (email, password, role) => {
    set({ isLoading: true })
    try {
      const result = await api.register(email, password, role)
      set({
        userId: result.userId,
        role: role as 'buyer' | 'dealer',
        isAuthenticated: true,
        isLoading: false,
      })
    } catch {
      set({ isLoading: false })
    }
  },

  logout: () => {
    set({ userId: null, role: null, isAuthenticated: false })
  },

  setRole: (role) => {
    set({ role })
  },
}))
