import { Stack } from 'expo-router'
import { AuthGuard } from '@/components/shared'

export default function AppLayout() {
  return (
    <AuthGuard>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="chat" />
        <Stack.Screen name="sessions" />
        <Stack.Screen name="simulations" />
        <Stack.Screen name="sim/[id]" />
        <Stack.Screen name="settings" />
      </Stack>
    </AuthGuard>
  )
}
