import { useState } from 'react'
import { TouchableOpacity } from 'react-native'
import { YStack, XStack, Text, Input, Button, H2 } from 'tamagui'
import { ThemedSafeArea } from '@/components/shared'
import { useRouter } from 'expo-router'
import { colors } from '@/lib/colors'
import { useAuthStore } from '@/stores/authStore'

export default function LoginScreen() {
  const router = useRouter()
  const { login, isLoading } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleLogin = async () => {
    await login(email || 'buyer@test.com', password || 'password')
    const role = useAuthStore.getState().role
    if (role === 'dealer') {
      router.replace('/(dealer)/simulations')
    } else {
      router.replace('/(buyer)/chat')
    }
  }

  return (
    <ThemedSafeArea>
      <YStack flex={1} justifyContent="center" padding="$7" backgroundColor="$background" gap="$5">
        <YStack gap="$2" marginBottom="$4">
          <H2 color="$color" fontWeight="700">Dealership AI</H2>
          <Text color="$colorSecondary" fontSize={16}>
            Your car buying advantage
          </Text>
        </YStack>

        <YStack gap="$3">
          <Input
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            size="$5"
            borderColor="$borderColor"
            backgroundColor="$backgroundStrong"
          />
          <Input
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            size="$5"
            borderColor="$borderColor"
            backgroundColor="$backgroundStrong"
          />
        </YStack>

        <Button
          size="$5"
          backgroundColor={colors.brand}
          color="white"
          fontWeight="600"
          onPress={handleLogin}
          disabled={isLoading}
          pressStyle={{ backgroundColor: colors.brandPressed }}
        >
          {isLoading ? 'Signing in...' : 'Sign In'}
        </Button>

        <TouchableOpacity
          onPress={() => router.push('/(auth)/register')}
          activeOpacity={0.6}
          style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
        >
          <XStack gap="$2">
            <Text color="$colorSecondary">Don't have an account?</Text>
            <Text color={colors.brand} fontWeight="600">
              Register
            </Text>
          </XStack>
        </TouchableOpacity>

        <Text
          color="$colorSecondary"
          fontSize={12}
          textAlign="center"
          marginTop="$4"
        >
          Mock mode: any credentials work. Use "dealer@" email for dealer app.
        </Text>
      </YStack>
    </ThemedSafeArea>
  )
}
