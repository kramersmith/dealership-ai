import { useState } from 'react'
import { TouchableOpacity } from 'react-native'
import { YStack, XStack, Text, Input, Button, H2 } from 'tamagui'
import { ThemedSafeArea } from '@/components/shared'
import { useRouter } from 'expo-router'
import { colors } from '@/lib/colors'
import { useAuthStore } from '@/stores/authStore'

export default function RegisterScreen() {
  const router = useRouter()
  const { register, isLoading } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'buyer' | 'dealer'>('buyer')

  const handleRegister = async () => {
    await register(email || 'buyer@test.com', password || 'password', role)
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
          <H2 color="$color" fontWeight="700">Create Account</H2>
          <Text color="$colorSecondary" fontSize={16}>
            Choose your side
          </Text>
        </YStack>

        <XStack gap="$3">
          <Button
            flex={1}
            size="$5"
            backgroundColor={role === 'buyer' ? colors.brand : '$backgroundStrong'}
            color={role === 'buyer' ? 'white' : '$color'}
            borderColor={role === 'buyer' ? colors.brand : '$borderColor'}
            borderWidth={1}
            fontWeight="600"
            onPress={() => setRole('buyer')}
          >
            Buyer
          </Button>
          <Button
            flex={1}
            size="$5"
            backgroundColor={role === 'dealer' ? colors.brand : '$backgroundStrong'}
            color={role === 'dealer' ? 'white' : '$color'}
            borderColor={role === 'dealer' ? colors.brand : '$borderColor'}
            borderWidth={1}
            fontWeight="600"
            onPress={() => setRole('dealer')}
          >
            Dealer
          </Button>
        </XStack>

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
          onPress={handleRegister}
          disabled={isLoading}
          pressStyle={{ backgroundColor: colors.brandPressed }}
        >
          {isLoading ? 'Creating account...' : 'Create Account'}
        </Button>

        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.6}
          style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
        >
          <XStack gap="$2">
            <Text color="$colorSecondary">Already have an account?</Text>
            <Text color={colors.brand} fontWeight="600">
              Sign In
          </Text>
          </XStack>
        </TouchableOpacity>
      </YStack>
    </ThemedSafeArea>
  )
}
