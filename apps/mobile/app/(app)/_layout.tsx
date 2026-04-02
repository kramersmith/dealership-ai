import { Stack } from 'expo-router'
import { AuthGuard } from '@/components/shared'

export default function AppLayout() {
  return (
    <AuthGuard>
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="chat" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="chats" />
        <Stack.Screen name="simulations" />
        <Stack.Screen name="sim/[id]" />
        <Stack.Screen name="settings" />
      </Stack>
    </AuthGuard>
  )
}
