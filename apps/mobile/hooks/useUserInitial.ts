import { useAuthStore } from '@/stores/authStore'

/** First letter of the signed-in user's email (or "Y" for "You" when unknown). */
export function useUserInitial(): string {
  const email = useAuthStore((state) => state.email)
  const trimmed = email?.trim()
  if (!trimmed) return 'Y'
  return trimmed.charAt(0).toUpperCase() || 'Y'
}
