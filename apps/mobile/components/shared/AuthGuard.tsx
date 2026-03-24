import { Redirect } from 'expo-router'
import { useAuthStore } from '@/stores/authStore'
import type { ReactNode } from 'react'

export function AuthGuard({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />
  }

  return <>{children}</>
}
