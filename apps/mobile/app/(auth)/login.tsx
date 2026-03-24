import { useState } from 'react'
import { TouchableOpacity } from 'react-native'
import { YStack, XStack, Text, Input, Button, H2, Separator } from 'tamagui'
import { ThemedSafeArea } from '@/components/shared'
import { useRouter } from 'expo-router'
import { colors } from '@/lib/colors'
import { useAuthStore } from '@/stores/authStore'

function QuickSignInButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Button
      size="$5"
      backgroundColor="$backgroundStrong"
      borderWidth={1}
      borderColor="$borderColor"
      onPress={onPress}
      pressStyle={{ backgroundColor: '$backgroundHover' }}
      flex={1}
    >
      <Button.Text color="$color" fontWeight="600">{label}</Button.Text>
    </Button>
  )
}

export default function LoginScreen() {
  const router = useRouter()
  const { login, isLoading, error, clearError } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const signInAndRedirect = async (emailAddress: string, userPassword: string) => {
    try {
      await login(emailAddress, userPassword)
    } catch {
      // Error is already set in the auth store
      return
    }
    const state = useAuthStore.getState()
    if (!state.isAuthenticated) return
    if (state.role === 'dealer') {
      router.replace('/(dealer)/simulations')
    } else {
      router.replace('/(buyer)/chat')
    }
  }

  const handleLogin = () => signInAndRedirect(email, password)

  return (
    <ThemedSafeArea>
      <YStack flex={1} justifyContent="center" padding="$7" backgroundColor="$background" gap="$5">
        <YStack gap="$2" marginBottom="$4">
          <H2 color="$color" fontWeight="700">Dealership AI</H2>
          <Text color="$placeholderColor" fontSize={16}>
            Your car buying advantage
          </Text>
        </YStack>

        {error && (
          <YStack
            backgroundColor="$red2"
            borderColor="$red8"
            borderWidth={1}
            borderRadius="$3"
            padding="$3"
          >
            <Text color="$red10" fontSize={14}>
              {error}
            </Text>
          </YStack>
        )}

        {/* Quick sign-in buttons — dev only, hidden in production builds */}
        {__DEV__ && (
          <>
            <YStack gap="$3">
              <Text color="$placeholderColor" fontSize={13} textTransform="uppercase" letterSpacing={1}>
                Quick Sign In
              </Text>
              <XStack gap="$3">
                <QuickSignInButton
                  label="Buyer"
                  onPress={() => signInAndRedirect('buyer@test.com', 'password')}
                />
                <QuickSignInButton
                  label="Dealer"
                  onPress={() => signInAndRedirect('dealer@test.com', 'password')}
                />
              </XStack>
            </YStack>

            <XStack alignItems="center" gap="$3">
              <Separator flex={1} />
              <Text color="$placeholderColor" fontSize={13}>or sign in with email</Text>
              <Separator flex={1} />
            </XStack>
          </>
        )}

        <YStack gap="$3">
          <Input
            placeholder="Email"
            value={email}
            onChangeText={(text) => { clearError(); setEmail(text) }}
            autoCapitalize="none"
            keyboardType="email-address"
            size="$5"
            borderColor="$borderColor"
            backgroundColor="$backgroundStrong"
          />
          <Input
            placeholder="Password"
            value={password}
            onChangeText={(text) => { clearError(); setPassword(text) }}
            secureTextEntry
            size="$5"
            borderColor="$borderColor"
            backgroundColor="$backgroundStrong"
          />
        </YStack>

        <Button
          size="$5"
          backgroundColor={colors.brand}
          onPress={handleLogin}
          disabled={isLoading}
          pressStyle={{ backgroundColor: colors.brandPressed }}
        >
          <Button.Text color="white" fontWeight="600">
            {isLoading ? 'Signing in...' : 'Sign In'}
          </Button.Text>
        </Button>

        <TouchableOpacity
          onPress={() => router.push('/(auth)/register')}
          activeOpacity={0.6}
          style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
        >
          <XStack gap="$2">
            <Text color="$placeholderColor">Don't have an account?</Text>
            <Text color={colors.brand} fontWeight="600">
              Register
            </Text>
          </XStack>
        </TouchableOpacity>
      </YStack>
    </ThemedSafeArea>
  )
}
