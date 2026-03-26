import { Animated, TextInput, TouchableOpacity } from 'react-native'
import { XStack, YStack, Text, useTheme } from 'tamagui'
import { Pencil } from '@tamagui/lucide-icons'
import type { Vehicle } from '@/lib/types'
import { formatMileage, vehicleSummary } from '@/lib/utils'
import { HIGH_MILEAGE_THRESHOLD, VERY_HIGH_MILEAGE_THRESHOLD } from '@/lib/constants'
import { AppCard, StatusPill } from '@/components/shared'
import { useSlideIn } from '@/hooks/useAnimatedValue'
import { useEditableField } from '@/hooks/useEditableField'

interface VehicleCardProps {
  vehicle: Vehicle | null
  onCorrectField?: (field: keyof Vehicle, value: string | number | undefined) => void
}

interface EditableTextProps {
  value: string
  onSave: (v: string) => void
  fontSize?: number
  color?: string
  fontWeight?: string
  numberOfLines?: number
}

function EditableText({
  value,
  onSave,
  fontSize = 13,
  color = '$placeholderColor',
  fontWeight = '400',
  numberOfLines,
}: EditableTextProps) {
  const theme = useTheme()
  const { isEditing, editValue, justSaved, startEditing, setEditValue, commitEdit } =
    useEditableField(value, onSave)

  if (isEditing) {
    return (
      <XStack
        backgroundColor="$backgroundHover"
        borderRadius={6}
        paddingHorizontal={8}
        paddingVertical={4}
      >
        <TextInput
          value={editValue}
          onChangeText={setEditValue}
          onBlur={commitEdit}
          onSubmitEditing={commitEdit}
          autoFocus
          style={{
            fontSize,
            color: theme.color?.val as string,
            fontWeight: fontWeight as any,
            padding: 0,
            margin: 0,
            minWidth: 40,
          }}
        />
      </XStack>
    )
  }

  return (
    <YStack>
      <TouchableOpacity
        onPress={startEditing}
        activeOpacity={0.6}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <XStack alignItems="center" gap={4}>
          <Text
            fontSize={fontSize}
            color={color}
            fontWeight={fontWeight as any}
            numberOfLines={numberOfLines}
          >
            {value}
          </Text>
          <Pencil size={10} color="$placeholderColor" opacity={0.5} />
        </XStack>
      </TouchableOpacity>
      {justSaved && (
        <Text fontSize={10} color="$brand" opacity={0.8}>
          Saved — the AI will see this change on your next message
        </Text>
      )}
    </YStack>
  )
}

export function VehicleCard({ vehicle, onCorrectField }: VehicleCardProps) {
  const { opacity, translateY } = useSlideIn(300)

  if (!vehicle) return null

  const riskFlags: string[] = []
  if (vehicle.mileage && vehicle.mileage > VERY_HIGH_MILEAGE_THRESHOLD) {
    riskFlags.push('Very High Miles')
  } else if (vehicle.mileage && vehicle.mileage > HIGH_MILEAGE_THRESHOLD) {
    riskFlags.push('High Mileage')
  }

  const editable = !!onCorrectField

  const handleSave = (field: keyof Vehicle, raw: string) => {
    if (!onCorrectField) return
    if (field === 'year' || field === 'mileage') {
      const num = parseInt(raw.replace(/[^0-9]/g, ''), 10)
      if (!isNaN(num)) onCorrectField(field, num)
    } else {
      onCorrectField(field, raw)
    }
  }

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <AppCard accent gap="$2">
        <XStack justifyContent="space-between" alignItems="flex-start">
          <YStack flex={1} gap="$1.5">
            <Text fontSize={16} fontWeight="700" color="$color" numberOfLines={1}>
              {vehicleSummary(vehicle)}
            </Text>
            <XStack gap="$3">
              {vehicle.mileage !== undefined && editable ? (
                <EditableText
                  value={formatMileage(vehicle.mileage)}
                  onSave={(v) => handleSave('mileage', v)}
                />
              ) : vehicle.mileage !== undefined ? (
                <Text fontSize={13} color="$placeholderColor">
                  {formatMileage(vehicle.mileage)}
                </Text>
              ) : null}
              {vehicle.color && editable ? (
                <EditableText value={vehicle.color} onSave={(v) => handleSave('color', v)} />
              ) : vehicle.color ? (
                <Text fontSize={13} color="$placeholderColor">
                  {vehicle.color}
                </Text>
              ) : null}
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
