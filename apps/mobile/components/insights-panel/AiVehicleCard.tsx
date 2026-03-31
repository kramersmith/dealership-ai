import { View, Text as RNText, StyleSheet, Platform } from 'react-native'
import { useTheme } from 'tamagui'
import { AlertTriangle } from '@tamagui/lucide-icons'
import { formatMileage } from '@/lib/utils'

// NOTE: This component uses plain RN View/Text instead of Tamagui YStack/XStack/Text.
// This is a workaround for a Tamagui web runtime bug where the CSS class serialization
// calls JSON.stringify on the theme context, hitting a circular reference
// ("property 'Provider' closes the circle"). Other card components that use AppCard
// (NumbersCard, WarningCard, etc.) are not affected. The exact trigger is unknown —
// restoring the old EditableText sub-component (with useTheme + TextInput) prevents
// the crash, suggesting Tamagui's babel plugin uses file-level heuristics to decide
// whether to apply its optimization. Filed as a known issue to investigate further.

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
  primary: 'Target Vehicle',
  trade_in: 'Trade-In',
}

interface AiVehicleCardProps {
  title: string
  content: Record<string, any>
}

export function AiVehicleCard({ title, content }: AiVehicleCardProps) {
  const theme = useTheme()
  const vehicleContent = content as VehicleContent
  const vehicle = vehicleContent.vehicle
  const riskFlags = vehicleContent.risk_flags ?? []

  if (!vehicle || typeof vehicle !== 'object') return null

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

  const bgColor = theme.backgroundStrong?.val as string
  const borderColor = theme.borderColor?.val as string
  const textColor = theme.color?.val as string
  const mutedColor = theme.placeholderColor?.val as string
  const dangerColor = theme.danger?.val as string
  const shadowColor = theme.shadowColor?.val as string

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: bgColor,
          borderColor,
          ...(Platform.OS === 'web'
            ? { boxShadow: `0 1px 3px ${shadowColor}, 0 1px 2px ${shadowColor}` }
            : {
                shadowColor,
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 1,
                shadowRadius: 3,
                elevation: 2,
              }),
        } as any,
      ]}
    >
      <View style={styles.content}>
        <RNText style={[styles.label, { color: mutedColor }]}>{label}</RNText>

        <View style={styles.specsSection}>
          <RNText style={[styles.name, { color: textColor }]} numberOfLines={1}>
            {name}
          </RNText>
          {specs ? (
            <RNText style={[styles.specs, { color: mutedColor }]} numberOfLines={1}>
              {specs}
            </RNText>
          ) : null}
          {vehicle.vin ? (
            <RNText style={[styles.vin, { color: mutedColor }]}>VIN: {vehicle.vin}</RNText>
          ) : null}
        </View>

        {riskFlags.length > 0 && (
          <>
            <View style={[styles.divider, { backgroundColor: borderColor }]} />
            <View style={styles.flagsSection}>
              {riskFlags.map((flag) => (
                <View key={flag} style={styles.flagRow}>
                  <View style={styles.flagIcon}>
                    <AlertTriangle size={14} color={dangerColor} />
                  </View>
                  <RNText style={[styles.flagText, { color: dangerColor }]}>{flag}</RNText>
                </View>
              ))}
            </View>
          </>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
  },
  content: {
    gap: 12,
  },
  // Must match CardTitle styling (fontSize 12, fontWeight 600, uppercase, letterSpacing 0.5).
  // Duplicated here because this component uses RN primitives instead of Tamagui.
  label: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  specsSection: {
    gap: 6,
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
  },
  specs: {
    fontSize: 13,
  },
  vin: {
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  divider: {
    height: 1,
  },
  flagsSection: {
    gap: 8,
  },
  flagRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
  },
  flagIcon: {
    paddingTop: 2,
  },
  flagText: {
    fontSize: 13,
    flex: 1,
    lineHeight: 20,
  },
})
