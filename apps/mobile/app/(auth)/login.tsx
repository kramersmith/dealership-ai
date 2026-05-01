import { useState } from 'react'
import { Platform, TouchableOpacity, View } from 'react-native'
import { YStack, XStack, Text, Input, Button, Separator } from 'tamagui'
import { ThemedSafeArea, AnimatedError } from '@/components/shared'
import { useRouter } from 'expo-router'
import { APP_NAME, DISPLAY_FONT_FAMILY } from '@/lib/constants'
import { useAuthStore } from '@/stores/authStore'
import { palette } from '@/lib/theme/tokens'

function QuickSignInButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Button
      size="$5"
      backgroundColor="rgba(15, 23, 42, 0.60)"
      borderWidth={1}
      borderColor={palette.ghostBorder}
      borderRadius={14}
      onPress={onPress}
      pressStyle={{
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        borderColor: palette.copilotEmeraldBorder30,
      }}
      hoverStyle={{
        borderColor: palette.copilotEmeraldBorder40,
      }}
      flex={1}
    >
      <Button.Text color={palette.slate200} fontWeight="600">
        {label}
      </Button.Text>
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
      router.replace('/(app)/simulations')
    } else {
      router.replace('/(app)/chats')
    }
  }

  const handleLogin = () => signInAndRedirect(email, password)

  return (
    <ThemedSafeArea>
      <YStack flex={1} backgroundColor="$background" justifyContent="center">
        <YStack padding="$7" gap="$5" maxWidth={480} width="100%" alignSelf="center">
          {/* Frosted card surface — matches reference panel treatment. */}
          <View
            style={{
              borderRadius: 24,
              borderWidth: 1,
              borderColor: palette.ghostBorder,
              backgroundColor: palette.copilotFrostedRail,
              padding: 28,
              gap: 20,
              ...(Platform.OS === 'web'
                ? ({
                    backdropFilter: 'blur(20px) saturate(1.15)',
                    WebkitBackdropFilter: 'blur(20px) saturate(1.15)',
                  } as any)
                : {}),
            }}
          >
            <YStack gap="$2">
              <Text
                fontSize={36}
                fontWeight="300"
                color={palette.slate50}
                letterSpacing={-1.2}
                lineHeight={40}
                fontFamily={DISPLAY_FONT_FAMILY}
              >
                Welcome to{' '}
                <Text
                  fontStyle="italic"
                  fontWeight="400"
                  color={palette.copilotEmerald}
                  fontFamily={DISPLAY_FONT_FAMILY}
                >
                  {APP_NAME}
                </Text>
                <Text color={palette.copilotEmerald} fontFamily={DISPLAY_FONT_FAMILY}>
                  .
                </Text>
              </Text>
              <Text color={palette.slate400} fontSize={15} lineHeight={22}>
                Your car buying advantage.
              </Text>
            </YStack>

            {error && <AnimatedError message={error} />}

            {/* Quick sign-in buttons — dev only, hidden in production builds */}
            {__DEV__ && (
              <YStack gap="$3">
                <Text
                  color={palette.slate500}
                  fontSize={11}
                  fontWeight="600"
                  textTransform="uppercase"
                  letterSpacing={1.2}
                >
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

                <XStack alignItems="center" gap="$3" paddingVertical="$2">
                  <Separator flex={1} borderColor={palette.ghostBgHover} />
                  <Text color={palette.slate500} fontSize={12}>
                    or sign in with email
                  </Text>
                  <Separator flex={1} borderColor={palette.ghostBgHover} />
                </XStack>
              </YStack>
            )}

            <YStack gap="$3">
              <Input
                placeholder="Email"
                placeholderTextColor={palette.slate500 as any}
                value={email}
                onChangeText={(text) => {
                  clearError()
                  setEmail(text)
                }}
                autoCapitalize="none"
                keyboardType="email-address"
                size="$5"
                color={palette.slate50}
                borderWidth={1}
                borderColor={palette.ghostBorder}
                backgroundColor="rgba(2, 6, 23, 0.65)"
                borderRadius={12}
                focusStyle={{ borderColor: palette.copilotEmerald }}
              />
              <Input
                placeholder="Password"
                placeholderTextColor={palette.slate500 as any}
                value={password}
                onChangeText={(text) => {
                  clearError()
                  setPassword(text)
                }}
                secureTextEntry
                size="$5"
                color={palette.slate50}
                borderWidth={1}
                borderColor={palette.ghostBorder}
                backgroundColor="rgba(2, 6, 23, 0.65)"
                borderRadius={12}
                focusStyle={{ borderColor: palette.copilotEmerald }}
              />
            </YStack>

            <Button
              size="$5"
              backgroundColor={palette.slate50}
              borderRadius={14}
              onPress={handleLogin}
              disabled={isLoading}
              pressStyle={{ backgroundColor: palette.slate200 }}
              hoverStyle={{ backgroundColor: palette.white }}
            >
              <Button.Text color={palette.slate900} fontWeight="600">
                {isLoading ? 'Signing in…' : 'Sign In'}
              </Button.Text>
            </Button>

            <TouchableOpacity
              onPress={() => router.push('/(auth)/register')}
              activeOpacity={0.6}
              style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
            >
              <XStack gap="$2">
                <Text color={palette.slate400}>Don&apos;t have an account?</Text>
                <Text color={palette.copilotEmerald} fontWeight="600">
                  Register
                </Text>
              </XStack>
            </TouchableOpacity>
          </View>
        </YStack>
      </YStack>
    </ThemedSafeArea>
  )
}
