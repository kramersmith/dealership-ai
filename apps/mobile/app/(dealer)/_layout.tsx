import { Stack } from 'expo-router'

export default function DealerLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="simulations" />
      <Stack.Screen name="sim/[id]" />
      <Stack.Screen name="settings" />
    </Stack>
  )
}
