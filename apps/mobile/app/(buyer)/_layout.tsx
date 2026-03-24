import { Stack } from 'expo-router'
import { AuthGuard } from '@/components/shared'

export default function BuyerLayout() {
  return (
    <AuthGuard>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="chat" />
        <Stack.Screen name="sessions" />
        <Stack.Screen name="settings" />
      </Stack>
    </AuthGuard>
  )
}
