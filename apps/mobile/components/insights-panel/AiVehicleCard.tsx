import { XStack, YStack, Text } from 'tamagui'
import { AlertTriangle } from '@tamagui/lucide-icons'
import { formatMileage } from '@/lib/utils'
import { AppCard } from '@/components/shared'

interface VehicleContent {
  vehicle: {
    year: number
    make: string
    model: string
    trim?: string
    engine?: string
    mileage?: number
    color?: string
    vin?: string
    role?: 'primary' | 'trade_in'
  }
  risk_flags?: string[]
}

const ROLE_LABELS: Record<string, string> = {
  primary: 'Your Vehicle',
  trade_in: 'Trade-In',
}

interface AiVehicleCardProps {
  title: string
  content: Record<string, any>
}

export function AiVehicleCard({ title, content }: AiVehicleCardProps) {
  const vehicleContent = content as VehicleContent
  const vehicle = vehicleContent.vehicle
  const riskFlags = vehicleContent.risk_flags ?? []

  if (!vehicle) return null

  const name = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ')
  const titleIsVehicleName = name.toLowerCase() === title.toLowerCase()
  const label = titleIsVehicleName
    ? (vehicle.role && ROLE_LABELS[vehicle.role]) || 'Vehicle'
    : title

  const specs = [
    vehicle.engine,
    vehicle.mileage != null ? formatMileage(vehicle.mileage) : null,
    vehicle.color,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <AppCard compact>
      <YStack gap="$3">
        <Text
          fontSize={12}
          fontWeight="600"
          color="$placeholderColor"
          textTransform="uppercase"
          letterSpacing={0.5}
        >
          {label}
        </Text>

        <YStack gap="$1.5">
          <Text fontSize={16} fontWeight="700" color="$color" numberOfLines={1}>
            {name}
          </Text>
          {specs && (
            <Text fontSize={13} color="$placeholderColor" numberOfLines={1}>
              {specs}
            </Text>
          )}
          {vehicle.vin && (
            <Text fontSize={12} color="$placeholderColor" fontFamily="$mono">
              VIN: {vehicle.vin}
            </Text>
          )}
        </YStack>

        {riskFlags.length > 0 && (
          <>
            <YStack height={1} backgroundColor="$borderColor" />
            <YStack gap="$2">
              {riskFlags.map((flag) => (
                <XStack key={flag} gap="$1.5" alignItems="flex-start">
                  <YStack paddingTop="$0.5">
                    <AlertTriangle size={14} color="$danger" />
                  </YStack>
                  <Text fontSize={13} color="$danger" flex={1} lineHeight={20}>
                    {flag}
                  </Text>
                </XStack>
              ))}
            </YStack>
          </>
        )}
      </YStack>
    </AppCard>
  )
}
