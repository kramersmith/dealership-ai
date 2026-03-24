import { Animated } from 'react-native'
import { XStack, YStack, Text } from 'tamagui'
import type { Vehicle } from '@/lib/types'
import { formatMileage, vehicleSummary } from '@/lib/utils'
import { AppCard, StatusPill } from '@/components/shared'
import { useSlideIn } from '@/hooks/useAnimatedValue'

interface VehicleCardProps {
  vehicle: Vehicle | null
}

export function VehicleCard({ vehicle }: VehicleCardProps) {
  const { opacity, translateY } = useSlideIn(300)

  if (!vehicle) return null

  const riskFlags: string[] = []
  if (vehicle.mileage && vehicle.mileage > 100000) riskFlags.push('High Mileage')
  if (vehicle.mileage && vehicle.mileage > 150000) riskFlags.push('Very High Miles')

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <AppCard gap="$2">
        <XStack justifyContent="space-between" alignItems="flex-start">
          <YStack flex={1} gap="$1">
            <Text fontSize={16} fontWeight="700" color="$color" numberOfLines={1}>
              {vehicleSummary(vehicle)}
            </Text>
            <XStack gap="$3">
              {vehicle.mileage !== undefined && (
                <Text fontSize={13} color="$placeholderColor">
                  {formatMileage(vehicle.mileage)}
                </Text>
              )}
              {vehicle.color && (
                <Text fontSize={13} color="$placeholderColor">
                  {vehicle.color}
                </Text>
              )}
            </XStack>
            {vehicle.vin && (
              <Text fontSize={11} color="$placeholderColor" fontFamily="$mono">
                VIN: {vehicle.vin.substring(0, 11)}...
              </Text>
            )}
          </YStack>
        </XStack>

        {riskFlags.length > 0 && (
          <XStack gap="$2" flexWrap="wrap">
            {riskFlags.map((flag) => (
              <StatusPill key={flag} status="red" label={flag} size="sm" />
            ))}
          </XStack>
        )}
      </AppCard>
    </Animated.View>
  )
}
