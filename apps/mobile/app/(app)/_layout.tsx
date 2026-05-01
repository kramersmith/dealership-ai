import { Stack } from 'expo-router'
import { AuthGuard } from '@/components/shared'
import { palette } from '@/lib/theme/tokens'

export default function AppLayout() {
  return (
    <AuthGuard>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          // Match the slate-950 page bg so the screen container doesn't show
          // through as a lighter band above our painted top nav.
          contentStyle: { backgroundColor: palette.copilotBackground },
        }}
      >
        <Stack.Screen name="chat" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="chats" />
        <Stack.Screen name="simulations" />
        <Stack.Screen name="sim/[id]" />
        <Stack.Screen name="settings" />
      </Stack>
    </AuthGuard>
  )
}
