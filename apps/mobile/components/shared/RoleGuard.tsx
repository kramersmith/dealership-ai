import { Redirect } from 'expo-router'
import { useAuthStore } from '@/stores/authStore'
import type { ReactNode } from 'react'

export function RoleGuard({ role, children }: { role: 'buyer' | 'dealer'; children: ReactNode }) {
  const userRole = useAuthStore((state) => state.role)

  // Null role means not authenticated or role not yet set — redirect to login
  // (AuthGuard should catch this first, but defend against edge cases)
  if (!userRole) {
    return <Redirect href="/(auth)/login" />
  }

  if (userRole !== role) {
    return <Redirect href={userRole === 'dealer' ? '/(app)/simulations' : '/(app)/chat'} />
  }

  return <>{children}</>
}
