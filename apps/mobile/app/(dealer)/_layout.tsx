import { Stack } from 'expo-router'
import { AuthGuard } from '@/components/shared'

export default function DealerLayout() {
  return (
    <AuthGuard>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="simulations" />
        <Stack.Screen name="sim/[id]" />
        <Stack.Screen name="settings" />
      </Stack>
    </AuthGuard>
  )
}
