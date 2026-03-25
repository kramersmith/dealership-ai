import { Redirect } from 'expo-router'
import { useAuthStore } from '@/stores/authStore'

export default function Index() {
  const { isAuthenticated, role } = useAuthStore()

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />
  }

  if (role === 'dealer') {
    return <Redirect href="/(app)/simulations" />
  }

  return <Redirect href="/(app)/chats" />
}
