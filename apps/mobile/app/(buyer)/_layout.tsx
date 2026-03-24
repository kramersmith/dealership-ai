import { Stack } from 'expo-router'

export default function BuyerLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="chat" />
      <Stack.Screen name="sessions" />
      <Stack.Screen name="settings" />
    </Stack>
  )
}
