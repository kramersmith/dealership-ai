import { TextInput, TouchableOpacity } from 'react-native'
import { XStack, YStack, Text, useTheme } from 'tamagui'
import { Pencil } from '@tamagui/lucide-icons'
import { formatMileage } from '@/lib/utils'
import { AppCard } from '@/components/shared'
import { useEditableField } from '@/hooks/useEditableField'

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
  }
  risk_flags?: string[]
}

interface AiVehicleCardProps {
  title: string
  content: Record<string, any>
  /** The actual vehicle ID from the database — required for corrections. */
  vehicleId?: string
  onCorrectVehicleField?: (
    vehicleId: string,
    field: string,
    value: string | number | undefined
  ) => void
}

interface EditableTextProps {
  value: string
  onSave: (v: string) => void
  fontSize?: number
  color?: string
  fontWeight?: string
}

function EditableText({
  value,
  onSave,
  fontSize = 13,
  color = '$placeholderColor',
  fontWeight = '400',
}: EditableTextProps) {
  const theme = useTheme()
  const { isEditing, editValue, justSaved, startEditing, setEditValue, commitEdit } =
    useEditableField(value, onSave)

  if (isEditing) {
    return (
      <XStack
        backgroundColor="$backgroundHover"
        borderRadius="$2"
        paddingHorizontal="$2"
        paddingVertical="$1"
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
        <XStack alignItems="center" gap="$1">
          <Text fontSize={fontSize} color={color} fontWeight={fontWeight as any}>
            {value}
          </Text>
          <Pencil size={12} color="$placeholderColor" opacity={0.7} />
        </XStack>
      </TouchableOpacity>
      {justSaved && (
        <Text fontSize={11} fontWeight="500" color="$brand">
          Saved — AI will use this next
        </Text>
      )}
    </YStack>
  )
}

export function AiVehicleCard({
  title,
  content,
  vehicleId,
  onCorrectVehicleField,
}: AiVehicleCardProps) {
  const vehicleContent = content as VehicleContent
  const vehicle = vehicleContent.vehicle
  const riskFlags = vehicleContent.risk_flags ?? []

  if (!vehicle) return null

  const summary = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
    .filter(Boolean)
    .join(' ')

  const editable = !!vehicleId && !!onCorrectVehicleField

  const handleSave = (field: string, raw: string) => {
    if (!onCorrectVehicleField || !vehicleId) return
    if (field === 'year' || field === 'mileage') {
      const num = parseInt(raw.replace(/[^0-9]/g, ''), 10)
      if (!isNaN(num)) onCorrectVehicleField(vehicleId, field, num)
    } else {
      onCorrectVehicleField(vehicleId, field, raw)
    }
  }

  return (
    <AppCard compact gap="$2">
      <Text
        fontSize={12}
        fontWeight="600"
        color="$placeholderColor"
        textTransform="uppercase"
        letterSpacing={0.5}
      >
        {title}
      </Text>

      <XStack justifyContent="space-between" alignItems="flex-start">
        <YStack flex={1} gap="$1.5">
          <Text fontSize={16} fontWeight="700" color="$color" numberOfLines={1}>
            {summary}
          </Text>
          {vehicle.engine && (
            <Text fontSize={13} color="$placeholderColor" numberOfLines={1}>
              {vehicle.engine}
            </Text>
          )}
          <XStack gap="$3">
            {vehicle.mileage != null && editable ? (
              <EditableText
                value={formatMileage(vehicle.mileage)}
                onSave={(v) => handleSave('mileage', v)}
              />
            ) : vehicle.mileage != null ? (
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
            <Text fontSize={12} color="$placeholderColor" fontFamily="$mono">
              VIN: {vehicle.vin.substring(0, 11)}...
            </Text>
          )}
        </YStack>
      </XStack>

      {riskFlags.length > 0 && (
        <YStack gap="$1.5">
          {riskFlags.map((flag) => (
            <XStack
              key={flag}
              backgroundColor="$danger"
              borderRadius={8}
              paddingHorizontal="$2"
              paddingVertical="$1"
              alignSelf="flex-start"
            >
              <Text color="$white" fontSize={12} fontWeight="600" flexShrink={1}>
                {flag}
              </Text>
            </XStack>
          ))}
        </YStack>
      )}
    </AppCard>
  )
}
