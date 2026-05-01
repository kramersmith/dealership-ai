import { useState, useCallback, useRef, useEffect } from 'react'
import {
  View,
  Text as RNText,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
} from 'react-native'
import { useTheme } from 'tamagui'
import { AlertTriangle, Car, ChevronDown, Check } from '@tamagui/lucide-icons'
import { palette } from '@/lib/theme/tokens'
import { MONO_FONT_FAMILY } from '@/lib/constants'
import { formatMileage, formatCurrency } from '@/lib/utils'
import { useDealStore } from '@/stores/dealStore'
import { useChatStore, normalizeVinCandidate } from '@/stores/chatStore'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { useFocusBorder } from '@/hooks/useAnimatedValue'
import type { Vehicle, VehicleIntelligence } from '@/lib/types'

/** Fade in a child on mount */
function FadeInView({ children }: { children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 250,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start()
  }, [opacity])
  return <Animated.View style={{ opacity }}>{children}</Animated.View>
}

/** Animated chevron that rotates between up/down */
function AnimatedChevron({
  expanded,
  color,
  size = 14,
}: {
  expanded: boolean
  color: string
  size?: number
}) {
  const rotation = useRef(new Animated.Value(expanded ? 1 : 0)).current
  useEffect(() => {
    Animated.timing(rotation, {
      toValue: expanded ? 1 : 0,
      duration: 200,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start()
  }, [expanded, rotation])

  const rotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  })

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <ChevronDown size={size} color={color} />
    </Animated.View>
  )
}

// NOTE: This component uses plain RN View/Text instead of Tamagui YStack/XStack/Text.
// This is a workaround for a Tamagui web runtime bug where the CSS class serialization
// calls JSON.stringify on the theme context, hitting a circular reference.

interface VehicleContent {
  vehicle: {
    year: number
    make: string
    model: string
    trim?: string
    cab_style?: string
    bed_length?: string
    engine?: string
    mileage?: number
    color?: string
    vin?: string
    role?: 'primary' | 'candidate' | 'trade_in'
  }
  risk_flags?: string[]
}

const ROLE_LABELS: Record<string, string> = {
  primary: 'Target Vehicle',
  candidate: 'Comparison Vehicle',
  trade_in: 'Trade-In',
}

interface AiVehicleCardProps {
  title: string
  content: Record<string, any>
  /** Start with all intelligence sections collapsed (used in archived cards). */
  collapsedByDefault?: boolean
}

// ─── Intelligence Section Components ───

function SectionHeader({
  label,
  status,
  onPress,
  expanded,
  brandColor,
  mutedColor,
  successColor,
}: {
  label: string
  status: 'idle' | 'loading' | 'complete' | 'error'
  onPress: () => void
  expanded: boolean
  brandColor: string
  mutedColor: string
  successColor: string
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={styles.sectionHeader}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${status === 'complete' ? 'complete' : status === 'loading' ? 'loading' : 'not started'}`}
    >
      <RNText style={[styles.sectionLabel, { color: mutedColor }]}>{label}</RNText>
      <View style={styles.sectionRight}>
        {status === 'complete' && <Check size={14} color={successColor} />}
        {status === 'loading' && <ActivityIndicator size="small" color={brandColor} />}
        <AnimatedChevron expanded={expanded} color={mutedColor} />
      </View>
    </TouchableOpacity>
  )
}

function SpecRow({
  label,
  value,
  textColor,
  mutedColor,
}: {
  label: string
  value?: string | number | null
  textColor: string
  mutedColor: string
}) {
  if (value === undefined || value === null || value === '') return null
  return (
    <View style={styles.specRow}>
      <RNText style={[styles.specLabel, { color: mutedColor }]}>{label}</RNText>
      <RNText style={[styles.specValue, { color: textColor }]}>{value}</RNText>
    </View>
  )
}

function ActionButton({
  label,
  onPress,
  disabled,
  brandColor,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  brandColor: string
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      style={[styles.actionButton, { borderColor: brandColor, opacity: disabled ? 0.5 : 1 }]}
      accessibilityRole="button"
    >
      <RNText style={[styles.actionButtonText, { color: brandColor }]}>{label}</RNText>
    </TouchableOpacity>
  )
}

// ─── Raw Payload Helpers ───

/** NHTSA fields already shown as primary spec rows — skip in "all specs" */
const PRIMARY_SPEC_KEYS = new Set([
  'Make',
  'Model',
  'ModelYear',
  'Trim',
  'Series',
  'EngineConfiguration',
  'EngineCylinders',
  'EngineHP',
  'DisplacementL',
  'DisplacementCC',
  'DisplacementCI',
  'EngineModel',
  'BodyClass',
  'BodyCabType',
  'DriveType',
  'TransmissionStyle',
  'TransmissionSpeeds',
  'FuelTypePrimary',
  'VIN',
])

/** Fields that are internal/noise — never show to user */
const HIDDEN_KEYS = new Set([
  'ErrorCode',
  'ErrorText',
  'AdditionalErrorText',
  'VehicleDescriptor',
  'MakeID',
  'ModelID',
  'ManufacturerId',
  'NCSA_MakeID',
  'NCSA_ModelID',
  'NCSA_BodyType',
  'Note',
  'PossibleValues',
])

/** Convert PascalCase NHTSA key to a readable label */
function humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
}

/** Get extra spec rows from raw payload, excluding primary + hidden fields */
function getExtraSpecs(
  rawPayload: Record<string, any> | undefined
): { label: string; value: string }[] {
  if (!rawPayload) return []
  return Object.entries(rawPayload)
    .filter(
      ([key, value]) =>
        !PRIMARY_SPEC_KEYS.has(key) &&
        !HIDDEN_KEYS.has(key) &&
        !key.endsWith('ID') &&
        value != null &&
        value !== '' &&
        value !== 'Not Applicable' &&
        value !== '0' &&
        value !== '0.0'
    )
    .map(([key, value]) => ({ label: humanizeKey(key), value: String(value) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

// ─── Intelligence Sections ───

function DecodeSection({
  vehicle,
  intelligence,
  expanded,
  onToggle,
  colors,
}: {
  vehicle: Vehicle | null
  intelligence: VehicleIntelligence | null
  expanded: boolean
  onToggle: () => void
  colors: Colors
}) {
  const decodeVinAssistForVehicle = useChatStore((s) => s.decodeVinAssistForVehicle)
  const [showAllSpecs, setShowAllSpecs] = useState(false)
  const loadingAction = intelligence?.loadingAction ?? null
  const decode = intelligence?.decode
  const status = loadingAction === 'decode' ? 'loading' : decode ? 'complete' : 'idle'
  const extraSpecs = decode ? getExtraSpecs(decode.rawPayload) : []

  return (
    <View style={[styles.section, { backgroundColor: colors.sectionBgColor }]}>
      <SectionHeader
        label="Specs"
        status={status}
        onPress={onToggle}
        expanded={expanded}
        brandColor={colors.brandColor}
        mutedColor={colors.mutedColor}
        successColor={colors.successColor}
      />
      {expanded && (
        <FadeInView>
          <View style={styles.sectionContent}>
            {decode ? (
              <>
                <SpecRow
                  label="Engine"
                  value={decode.engine}
                  textColor={colors.textColor}
                  mutedColor={colors.mutedColor}
                />
                <SpecRow
                  label="Body"
                  value={decode.bodyType}
                  textColor={colors.textColor}
                  mutedColor={colors.mutedColor}
                />
                <SpecRow
                  label="Cab"
                  value={decode.rawPayload?.BodyCabType}
                  textColor={colors.textColor}
                  mutedColor={colors.mutedColor}
                />
                <SpecRow
                  label="Drivetrain"
                  value={decode.drivetrain}
                  textColor={colors.textColor}
                  mutedColor={colors.mutedColor}
                />
                <SpecRow
                  label="Transmission"
                  value={decode.transmission}
                  textColor={colors.textColor}
                  mutedColor={colors.mutedColor}
                />
                <SpecRow
                  label="Fuel"
                  value={decode.fuelType}
                  textColor={colors.textColor}
                  mutedColor={colors.mutedColor}
                />

                {extraSpecs.length > 0 && (
                  <>
                    <TouchableOpacity
                      onPress={() => setShowAllSpecs((prev) => !prev)}
                      activeOpacity={0.7}
                      style={styles.allSpecsToggle}
                      accessibilityRole="button"
                    >
                      <View style={styles.allSpecsToggleInner}>
                        <AnimatedChevron
                          expanded={showAllSpecs}
                          color={colors.brandColor}
                          size={12}
                        />
                        <RNText style={[styles.allSpecsToggleText, { color: colors.brandColor }]}>
                          {showAllSpecs
                            ? 'Hide extra specs'
                            : `All decoded specs (${extraSpecs.length} more)`}
                        </RNText>
                      </View>
                    </TouchableOpacity>

                    {showAllSpecs && (
                      <View style={styles.allSpecsList}>
                        {extraSpecs.map(({ label, value }) => (
                          <SpecRow
                            key={label}
                            label={label}
                            value={value}
                            textColor={colors.textColor}
                            mutedColor={colors.mutedColor}
                          />
                        ))}
                      </View>
                    )}
                  </>
                )}

                <RNText style={[styles.sourceNote, { color: colors.mutedColor }]}>
                  {decode.sourceSummary ?? 'NHTSA vPIC'}
                </RNText>
              </>
            ) : (
              <ActionButton
                label={loadingAction === 'decode' ? 'Decoding...' : 'Decode VIN'}
                onPress={() => {
                  if (vehicle?.vin) {
                    void decodeVinAssistForVehicle(vehicle.vin, vehicle.id)
                  }
                }}
                disabled={loadingAction !== null}
                brandColor={colors.brandColor}
              />
            )}
          </View>
        </FadeInView>
      )}
    </View>
  )
}

function HistorySection({
  vehicle,
  intelligence,
  expanded,
  onToggle,
  colors,
}: {
  vehicle: Vehicle | null
  intelligence: VehicleIntelligence | null
  expanded: boolean
  onToggle: () => void
  colors: Colors
}) {
  const checkVehicleHistory = useDealStore((s) => s.checkVehicleHistory)
  const loadingAction = intelligence?.loadingAction ?? null
  const history = intelligence?.historyReport
  const status = loadingAction === 'history' ? 'loading' : history ? 'complete' : 'idle'

  const hasRisk =
    history &&
    (history.hasSalvage ||
      history.hasTotalLoss ||
      history.hasTheftRecord ||
      history.hasOdometerIssue)

  return (
    <View style={[styles.section, { backgroundColor: colors.sectionBgColor }]}>
      <SectionHeader
        label="Title Check"
        status={status}
        onPress={onToggle}
        expanded={expanded}
        brandColor={colors.brandColor}
        mutedColor={colors.mutedColor}
        successColor={hasRisk ? colors.dangerColor : colors.successColor}
      />
      {expanded && (
        <FadeInView>
          <View style={styles.sectionContent}>
            {history ? (
              <>
                <SpecRow
                  label="Title brands"
                  value={
                    history.titleBrands.length > 0
                      ? history.titleBrands.join(', ')
                      : 'None reported'
                  }
                  textColor={colors.textColor}
                  mutedColor={colors.mutedColor}
                />
                <SpecRow
                  label="Risk flags"
                  value={
                    [
                      history.hasSalvage ? 'Salvage' : null,
                      history.hasTotalLoss ? 'Total loss' : null,
                      history.hasTheftRecord ? 'Theft record' : null,
                      history.hasOdometerIssue ? 'Odometer issue' : null,
                    ]
                      .filter(Boolean)
                      .join(' | ') || 'No major flags'
                  }
                  textColor={hasRisk ? colors.dangerColor : colors.textColor}
                  mutedColor={colors.mutedColor}
                />
                <RNText style={[styles.sourceNote, { color: colors.mutedColor }]}>
                  {history.coverageNotes ??
                    'NMVTIS title and brand check — not full service history.'}
                </RNText>
              </>
            ) : (
              <ActionButton
                label={loadingAction === 'history' ? 'Checking...' : 'Check title history'}
                onPress={() => {
                  if (vehicle) {
                    void checkVehicleHistory(vehicle.id, vehicle.vin)
                  }
                }}
                disabled={loadingAction !== null}
                brandColor={colors.brandColor}
              />
            )}
          </View>
        </FadeInView>
      )}
    </View>
  )
}

function ValuationSection({
  vehicle,
  intelligence,
  expanded,
  onToggle,
  colors,
}: {
  vehicle: Vehicle | null
  intelligence: VehicleIntelligence | null
  expanded: boolean
  onToggle: () => void
  colors: Colors
}) {
  const getVehicleValuation = useDealStore((s) => s.getVehicleValuation)
  const loadingAction = intelligence?.loadingAction ?? null
  const valuation = intelligence?.valuation
  const status = loadingAction === 'valuation' ? 'loading' : valuation ? 'complete' : 'idle'

  return (
    <View style={[styles.section, { backgroundColor: colors.sectionBgColor }]}>
      <SectionHeader
        label="Market Value"
        status={status}
        onPress={onToggle}
        expanded={expanded}
        brandColor={colors.brandColor}
        mutedColor={colors.mutedColor}
        successColor={colors.successColor}
      />
      {expanded && (
        <FadeInView>
          <View style={styles.sectionContent}>
            {valuation ? (
              <>
                <RNText style={[styles.valuationAmount, { color: colors.textColor }]}>
                  {formatCurrency(valuation.amount ?? null)}
                </RNText>
                <RNText style={[styles.valuationLabel, { color: colors.mutedColor }]}>
                  {valuation.valuationLabel ?? 'Estimated Market Value'}
                </RNText>
                <RNText style={[styles.sourceNote, { color: colors.mutedColor }]}>
                  {valuation.sourceSummary ?? 'Listing-based estimate, not transaction value.'}
                </RNText>
              </>
            ) : (
              <ActionButton
                label={loadingAction === 'valuation' ? 'Pricing...' : 'Get market value'}
                onPress={() => {
                  if (vehicle) {
                    void getVehicleValuation(vehicle.id, vehicle.vin)
                  }
                }}
                disabled={loadingAction !== null}
                brandColor={colors.brandColor}
              />
            )}
          </View>
        </FadeInView>
      )}
    </View>
  )
}

// ─── VIN Prompt ───

function VinPrompt({ colors }: { colors: Colors }) {
  const [expanded, setExpanded] = useState(false)
  const [vinInput, setVinInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const focusBorder = useFocusBorder(colors.borderColor, colors.borderColorHover)

  const handleSubmit = useCallback(async () => {
    const normalized = normalizeVinCandidate(vinInput)
    if (!normalized) {
      setError('Enter a valid 17-character VIN')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      // Auto-decode from panel — skips the "Decode VIN?" prompt, goes straight to confirm
      await useChatStore.getState().submitVinFromPanel(normalized)
      setVinInput('')
      setExpanded(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decode VIN')
    } finally {
      setSubmitting(false)
    }
  }, [vinInput])

  return (
    <View style={[styles.vinPrompt, { backgroundColor: colors.sectionBgColor }]}>
      <TouchableOpacity
        onPress={() => setExpanded((prev) => !prev)}
        activeOpacity={0.7}
        style={styles.vinPromptHeader}
        accessibilityRole="button"
        accessibilityLabel="Add VIN for deeper insights"
      >
        <RNText style={[styles.vinPromptTitle, { color: colors.textColor }]}>
          Add VIN for deeper insights
        </RNText>
        <View style={styles.vinInfoToggle}>
          <AnimatedChevron expanded={expanded} color={colors.mutedColor} />
        </View>
      </TouchableOpacity>
      {expanded && (
        <FadeInView>
          <View style={styles.vinPromptBody}>
            <RNText style={[styles.vinPromptDesc, { color: colors.mutedColor }]}>
              With the VIN we can decode full specs, check title history, and get market value.
            </RNText>
            <View style={styles.vinInputRow}>
              <Animated.View
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderRadius: 8,
                  borderColor: focusBorder.borderColor,
                  backgroundColor: colors.bgColor,
                  overflow: 'hidden',
                }}
              >
                <TextInput
                  style={[
                    styles.vinInput,
                    {
                      color: colors.textColor,
                      borderWidth: 0,
                    },
                  ]}
                  value={vinInput}
                  onChangeText={(text) => {
                    setVinInput(text.toUpperCase())
                    if (error) setError(null)
                  }}
                  onFocus={focusBorder.onFocus}
                  onBlur={focusBorder.onBlur}
                  placeholder="e.g. 1FT7W2BN0NED52782"
                  placeholderTextColor={colors.mutedColor}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={17}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                  editable={!submitting}
                />
              </Animated.View>
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={submitting || vinInput.length < 17}
                activeOpacity={0.7}
                style={[
                  styles.vinSubmitButton,
                  {
                    backgroundColor: colors.brandColor,
                    opacity: submitting || vinInput.length < 17 ? 0.5 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Submit VIN"
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={colors.inverseTextColor} />
                ) : (
                  <RNText style={[styles.vinSubmitText, { color: colors.inverseTextColor }]}>
                    Add
                  </RNText>
                )}
              </TouchableOpacity>
            </View>
            {error ? (
              <FadeInView>
                <RNText style={[styles.vinPromptError, { color: colors.dangerColor }]}>
                  {error}
                </RNText>
              </FadeInView>
            ) : null}
            <RNText style={[styles.vinPromptHint, { color: colors.mutedColor }]}>
              Or paste it in the chat.
            </RNText>
          </View>
        </FadeInView>
      )}
    </View>
  )
}

// ─── Colors type ───

interface Colors {
  bgColor: string
  sectionBgColor: string
  borderColor: string
  borderColorHover: string
  textColor: string
  mutedColor: string
  dangerColor: string
  brandColor: string
  successColor: string
  shadowColor: string
  inverseTextColor: string
}

// ─── Main Component ───

export function AiVehicleCard({ title, content, collapsedByDefault = false }: AiVehicleCardProps) {
  const theme = useTheme()
  const vehicleContent = content as VehicleContent
  const vehicle = vehicleContent.vehicle
  const riskFlags = vehicleContent.risk_flags ?? []

  // Find the matching vehicle in deal state to get intelligence data
  const dealVehicle = useDealStore(
    useCallback(
      (state) => {
        if (!vehicle?.vin) return null
        return state.dealState?.vehicles.find((candidate) => candidate.vin === vehicle.vin) ?? null
      },
      [vehicle?.vin]
    )
  )
  const intelligence = dealVehicle?.intelligence ?? null

  // Section expansion state — default to expanded if no data yet
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    specs: !collapsedByDefault,
    history: false,
    valuation: false,
  })

  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }, [])

  if (!vehicle || typeof vehicle !== 'object') return null

  const name = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ')
  const titleIsVehicleName = name.toLowerCase() === title.toLowerCase()
  const label = titleIsVehicleName
    ? (vehicle.role && ROLE_LABELS[vehicle.role]) || 'Vehicle'
    : title

  const specs = [
    vehicle.cab_style,
    vehicle.bed_length,
    vehicle.engine,
    vehicle.mileage != null ? formatMileage(vehicle.mileage) : null,
    vehicle.color,
  ]
    .filter(Boolean)
    .join(' · ')

  const colors: Colors = {
    bgColor: theme.backgroundStrong?.val as string,
    // Carved-in inset surface for sub-sections (Specs / Title Check / Market
    // Value). Slightly darker than the card itself so it reads as nested,
    // matching the rgba slate-950 wells used elsewhere in the new design.
    sectionBgColor: 'rgba(2, 6, 23, 0.5)',
    borderColor: theme.borderColor?.val as string,
    borderColorHover: theme.borderColorHover?.val as string,
    textColor: theme.color?.val as string,
    mutedColor: theme.placeholderColor?.val as string,
    dangerColor: theme.danger?.val as string,
    brandColor: theme.brand?.val as string,
    successColor: theme.positive?.val as string,
    shadowColor: theme.shadowColor?.val as string,
    inverseTextColor: ((theme.white?.val as string | undefined) ??
      (theme.color?.val as string | undefined)) as string,
  }

  const hasVin = !!vehicle.vin

  return (
    <View style={[styles.card, { borderColor: palette.ghostBorder }]}>
      {/* Card header with divider */}
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.iconTile,
            {
              backgroundColor: 'rgba(52, 211, 153, 0.10)',
              borderColor: palette.copilotEmeraldBorder30,
            },
          ]}
        >
          <Car size={12} color={palette.copilotEmerald} />
        </View>
        <RNText style={[styles.titleHeadline, { color: palette.slate100, flex: 1 }]}>
          {label}
        </RNText>
      </View>

      <View style={styles.content}>
        <View style={styles.specsSection}>
          {name ? <RNText style={[styles.name, { color: colors.textColor }]}>{name}</RNText> : null}
          {specs ? (
            <RNText style={[styles.specsLine, { color: colors.mutedColor }]} numberOfLines={1}>
              {specs}
            </RNText>
          ) : null}
          {vehicle.vin ? (
            <RNText style={[styles.vin, { color: colors.mutedColor }]}>VIN: {vehicle.vin}</RNText>
          ) : null}
        </View>

        {/* VIN Prompt — when no VIN is available */}
        {!hasVin && <VinPrompt colors={colors} />}

        {/* Intelligence Sections — only show when a VIN is available */}
        {hasVin && (
          <>
            <DecodeSection
              vehicle={dealVehicle}
              intelligence={intelligence}
              expanded={expandedSections.specs ?? true}
              onToggle={() => toggleSection('specs')}
              colors={colors}
            />

            <HistorySection
              vehicle={dealVehicle}
              intelligence={intelligence}
              expanded={expandedSections.history ?? false}
              onToggle={() => toggleSection('history')}
              colors={colors}
            />

            <ValuationSection
              vehicle={dealVehicle}
              intelligence={intelligence}
              expanded={expandedSections.valuation ?? false}
              onToggle={() => toggleSection('valuation')}
              colors={colors}
            />

            {/* Error display */}
            {intelligence?.error ? (
              <FadeInView>
                <RNText style={[styles.errorText, { color: colors.dangerColor }]}>
                  {intelligence.error}
                </RNText>
              </FadeInView>
            ) : null}
          </>
        )}

        {/* Risk Flags */}
        {riskFlags.length > 0 && (
          <View style={styles.flagsSection}>
            {riskFlags.map((flag) => (
              <View key={flag} style={styles.flagRow}>
                <View style={styles.flagIcon}>
                  <AlertTriangle size={14} color={colors.dangerColor} />
                </View>
                <RNText style={[styles.flagText, { color: colors.dangerColor }]}>{flag}</RNText>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: palette.copilotFrostedRail,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  content: {
    gap: 12,
    padding: 16,
  },
  iconTile: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  titleHeadline: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  aiLiveTag: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  specsSection: {
    gap: 6,
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
  },
  specsLine: {
    fontSize: 13,
  },
  vin: {
    fontSize: 12,
    letterSpacing: 0.4,
    fontFamily: MONO_FONT_FAMILY,
  },
  // Intelligence sections
  section: {
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: palette.ghostBgSubtle,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    minHeight: 44,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionContent: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    gap: 6,
  },
  specRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  specLabel: {
    fontSize: 12,
  },
  specValue: {
    fontSize: 12,
    textAlign: 'right',
    flex: 1,
  },
  sourceNote: {
    fontSize: 11,
    marginTop: 4,
  },
  allSpecsToggle: {
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 2,
  },
  allSpecsToggleInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  allSpecsToggleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  allSpecsList: {
    gap: 6,
  },
  actionButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  valuationAmount: {
    fontSize: 20,
    fontWeight: '800',
  },
  valuationLabel: {
    fontSize: 12,
  },
  errorText: {
    fontSize: 12,
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
  // VIN prompt
  vinPrompt: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  vinPromptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    minHeight: 44,
  },
  vinInfoToggle: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vinPromptTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  vinPromptBody: {
    paddingHorizontal: 10,
    paddingBottom: 12,
    gap: 10,
  },
  vinPromptDesc: {
    fontSize: 13,
    lineHeight: 19,
  },
  vinInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  vinInput: {
    flex: 1,
    borderWidth: 0,
    paddingHorizontal: 12,
    fontSize: 14,
    fontFamily: MONO_FONT_FAMILY,
    letterSpacing: 0.4,
    minHeight: 44,
    outlineWidth: 0,
  } as any,
  vinSubmitButton: {
    borderRadius: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  vinSubmitText: {
    fontSize: 14,
    fontWeight: '600',
  },
  vinPromptError: {
    fontSize: 12,
  },
  vinPromptHint: {
    fontSize: 12,
  },
})
