import { useState } from 'react'
import { Platform, TouchableOpacity, View } from 'react-native'
import { YStack, XStack, Text, Input, Button } from 'tamagui'
import { ThemedSafeArea, AnimatedError } from '@/components/shared'
import { useRouter } from 'expo-router'
import { DISPLAY_FONT_FAMILY } from '@/lib/constants'
import { useAuthStore } from '@/stores/authStore'
import { palette } from '@/lib/theme/tokens'

export default function RegisterScreen() {
  const router = useRouter()
  const { register, isLoading, error, clearError } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'buyer' | 'dealer'>('buyer')

  const handleRegister = async () => {
    try {
      await register(email, password, role)
    } catch {
      // Error is already set in the auth store
      return
    }
    const state = useAuthStore.getState()
    if (!state.isAuthenticated) return
    if (role === 'dealer') {
      router.replace('/(app)/simulations')
    } else {
      router.replace('/(app)/chat')
    }
  }

  return (
    <ThemedSafeArea>
      <YStack flex={1} backgroundColor="$background" justifyContent="center">
        <YStack padding="$7" gap="$5" maxWidth={480} width="100%" alignSelf="center">
          <View
            style={{
              borderRadius: 24,
              borderWidth: 1,
              borderColor: palette.ghostBorder,
              backgroundColor: 'rgba(15, 23, 42, 0.60)',
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
                Create your{' '}
                <Text
                  fontStyle="italic"
                  fontWeight="400"
                  color={palette.copilotEmerald}
                  fontFamily={DISPLAY_FONT_FAMILY}
                >
                  account
                </Text>
                <Text color={palette.copilotEmerald} fontFamily={DISPLAY_FONT_FAMILY}>
                  .
                </Text>
              </Text>
              <Text color={palette.slate400} fontSize={15} lineHeight={22}>
                Are you buying or selling?
              </Text>
            </YStack>

            {error && <AnimatedError message={error} />}

            <XStack gap="$3">
              <RoleToggle
                label="Buying"
                active={role === 'buyer'}
                onPress={() => setRole('buyer')}
              />
              <RoleToggle
                label="Selling"
                active={role === 'dealer'}
                onPress={() => setRole('dealer')}
              />
            </XStack>

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
              onPress={handleRegister}
              disabled={isLoading}
              pressStyle={{ backgroundColor: palette.slate200 }}
              hoverStyle={{ backgroundColor: '#ffffff' }}
            >
              <Button.Text color={palette.slate900} fontWeight="600">
                {isLoading ? 'Creating account…' : 'Create Account'}
              </Button.Text>
            </Button>

            <TouchableOpacity
              onPress={() => router.back()}
              activeOpacity={0.6}
              style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
            >
              <XStack gap="$2">
                <Text color={palette.slate400}>Already have an account?</Text>
                <Text color={palette.copilotEmerald} fontWeight="600">
                  Sign In
                </Text>
              </XStack>
            </TouchableOpacity>
          </View>
        </YStack>
      </YStack>
    </ThemedSafeArea>
  )
}

function RoleToggle({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <Button
      flex={1}
      size="$5"
      borderRadius={14}
      borderWidth={1}
      backgroundColor={active ? palette.slate50 : 'rgba(15, 23, 42, 0.60)'}
      borderColor={active ? palette.slate50 : palette.ghostBorder}
      onPress={onPress}
      pressStyle={{ opacity: 0.85, scale: 0.98 }}
      hoverStyle={{
        borderColor: active ? '#ffffff' : palette.copilotEmeraldBorder40,
      }}
    >
      <Button.Text color={active ? palette.slate900 : palette.slate200} fontWeight="600">
        {label}
      </Button.Text>
    </Button>
  )
}
