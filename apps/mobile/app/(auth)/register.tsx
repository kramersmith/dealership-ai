import { useState } from 'react'
import { TouchableOpacity } from 'react-native'
import { YStack, XStack, Text, Input, Button, H2 } from 'tamagui'
import { ThemedSafeArea } from '@/components/shared'
import { useRouter } from 'expo-router'
import { colors } from '@/lib/colors'
import { useAuthStore } from '@/stores/authStore'

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
      <YStack flex={1} justifyContent="center" padding="$7" backgroundColor="$background" gap="$5" maxWidth={480} width="100%" alignSelf="center">
        <YStack gap="$2" marginBottom="$4">
          <H2 color="$color" fontWeight="700">Create Account</H2>
          <Text color="$placeholderColor" fontSize={16}>
            Are you buying or selling?
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

        <XStack gap="$3">
          <Button
            flex={1}
            size="$5"
            backgroundColor={role === 'buyer' ? colors.brand : '$backgroundStrong'}
            borderColor={role === 'buyer' ? colors.brand : '$borderColor'}
            borderWidth={1}
            onPress={() => setRole('buyer')}
            pressStyle={{ opacity: 0.85, scale: 0.98 }}
          >
            <Button.Text color={role === 'buyer' ? 'white' : '$color'} fontWeight="600">
              Buying
            </Button.Text>
          </Button>
          <Button
            flex={1}
            size="$5"
            backgroundColor={role === 'dealer' ? colors.brand : '$backgroundStrong'}
            borderColor={role === 'dealer' ? colors.brand : '$borderColor'}
            borderWidth={1}
            onPress={() => setRole('dealer')}
            pressStyle={{ opacity: 0.85, scale: 0.98 }}
          >
            <Button.Text color={role === 'dealer' ? 'white' : '$color'} fontWeight="600">
              Selling
            </Button.Text>
          </Button>
        </XStack>

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
          onPress={handleRegister}
          disabled={isLoading}
          pressStyle={{ backgroundColor: colors.brandPressed }}
        >
          <Button.Text color="white" fontWeight="600">
            {isLoading ? 'Creating account...' : 'Create Account'}
          </Button.Text>
        </Button>

        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.6}
          style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
        >
          <XStack gap="$2">
            <Text color="$placeholderColor">Already have an account?</Text>
            <Text color={colors.brand} fontWeight="600">
              Sign In
          </Text>
          </XStack>
        </TouchableOpacity>
      </YStack>
    </ThemedSafeArea>
  )
}
