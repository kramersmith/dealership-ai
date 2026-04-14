import { useRef, useEffect, useCallback } from 'react'
import { Animated, Pressable, TouchableOpacity, Platform, View } from 'react-native'
import { Trash2 } from '@tamagui/lucide-icons'
import { XStack, YStack, Text, useTheme } from 'tamagui'
import type { DealPhase, DealSummary, Session } from '@/lib/types'
import { DEAL_PHASES } from '@/lib/constants'
import { formatCurrency, stripMarkdown } from '@/lib/utils'
import { HoverLiftFrame } from '@/components/shared/HoverLiftFrame'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { palette } from '@/lib/theme/tokens'
import { darkTheme } from '@/lib/theme/themes'

// ─── Phase card styling ───

const PHASE_STYLE: Record<DealPhase, { accentToken: string }> = {
  research: { accentToken: '$placeholderColor' },
  initial_contact: { accentToken: '$brand' },
  test_drive: { accentToken: '$brand' },
  negotiation: { accentToken: '$warning' },
  financing: { accentToken: '$warning' },
  closing: { accentToken: '$positive' },
}

function phaseLabel(phase: DealPhase): string {
  return DEAL_PHASES.find((p) => p.key === phase)?.label ?? phase.replace(/_/g, ' ')
}

// ─── Relative time formatter ───

const MS_PER_MINUTE = 1000 * 60
const MS_PER_HOUR = MS_PER_MINUTE * 60
const MS_PER_DAY = MS_PER_HOUR * 24
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const DAYS_PER_WEEK = 7

function formatRelativeTime(dateStr: string): string {
  const timestamp = new Date(dateStr).getTime()
  if (Number.isNaN(timestamp)) return ''
  const diffMs = Date.now() - timestamp
  if (diffMs < 0) return 'Just now'
  const diffMinutes = Math.floor(diffMs / MS_PER_MINUTE)
  const diffHours = Math.floor(diffMs / MS_PER_HOUR)
  const diffDays = Math.floor(diffMs / MS_PER_DAY)
  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < MINUTES_PER_HOUR) return `${diffMinutes}m ago`
  if (diffHours < HOURS_PER_DAY) return `${diffHours}h ago`
  if (diffDays < DAYS_PER_WEEK) return `${diffDays}d ago`
  return new Date(dateStr).toLocaleDateString()
}

// ─── Deal summary line builder ───

function buildSummaryLine(summary: DealSummary | null): string | null {
  if (!summary) return null
  const parts: string[] = []

  if (summary.vehicleMake) {
    const vehicleParts = []
    if (summary.vehicleYear) vehicleParts.push(String(summary.vehicleYear))
    vehicleParts.push(summary.vehicleMake)
    if (summary.vehicleModel) vehicleParts.push(summary.vehicleModel)
    parts.push(vehicleParts.join(' '))
  }

  if (summary.phase) {
    parts.push(phaseLabel(summary.phase))
  }

  const price = summary.currentOffer ?? summary.listingPrice
  if (price != null) {
    parts.push(formatCurrency(price))
  }

  return parts.length > 0 ? parts.join(' \u00B7 ') : null
}

// ─── Component ───

interface SessionCardProps {
  session: Session
  index: number
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  isFocused?: boolean
}

const STAGGER_DELAY = 40
const SLIDE_DURATION = 250
const SLIDE_DISTANCE = 12

export function SessionCard({
  session,
  index,
  onSelect,
  onDelete,
  isFocused = true,
}: SessionCardProps) {
  const opacity = useRef(new Animated.Value(0)).current
  const translateY = useRef(new Animated.Value(SLIDE_DISTANCE)).current

  useEffect(() => {
    if (!isFocused) return
    opacity.setValue(0)
    translateY.setValue(SLIDE_DISTANCE)
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: SLIDE_DURATION,
        delay: index * STAGGER_DELAY,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: SLIDE_DURATION,
        delay: index * STAGGER_DELAY,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start()
  }, [isFocused, index, opacity, translateY])
  const pressScale = useRef(new Animated.Value(1)).current
  const theme = useTheme()

  const handlePressIn = useCallback(() => {
    Animated.timing(pressScale, {
      toValue: 0.98,
      duration: 100,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start()
  }, [pressScale])

  const handlePressOut = useCallback(() => {
    Animated.timing(pressScale, {
      toValue: 1,
      duration: 150,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start()
  }, [pressScale])

  const phase = session.dealSummary?.phase ?? 'research'
  const phaseStyle = PHASE_STYLE[phase] ?? PHASE_STYLE.research
  const summaryLine = buildSummaryLine(session.dealSummary)
  const previewText = session.lastMessagePreview ? stripMarkdown(session.lastMessagePreview) : null
  const shadow = theme.shadowColor?.val ?? palette.overlay
  const isDarkTheme = theme.background?.val === darkTheme.background
  const dividerColor = isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(28,30,33,0.08)'
  const accessibilityText = [
    session.title,
    session.dealSummary?.phase ? phaseLabel(session.dealSummary.phase) : null,
    session.lastMessagePreview || null,
  ]
    .filter(Boolean)
    .join(', ')

  const dealSnapshotColumn = (
    <YStack flex={1} minWidth={0} gap="$1" alignItems="flex-start">
      <Text
        fontSize={10}
        fontWeight="700"
        color={phaseStyle.accentToken}
        textTransform="uppercase"
        letterSpacing={0.9}
        textAlign="left"
      >
        Deal snapshot
      </Text>

      <Text fontSize={12} color="$placeholderColor" opacity={0.88} textAlign="left" width="100%">
        {summaryLine ?? 'Continue the conversation'}
      </Text>
    </YStack>
  )

  const card = (
    <YStack
      width="100%"
      backgroundColor="$backgroundStrong"
      borderRadius={18}
      borderWidth={1}
      borderColor="$borderColor"
      overflow="hidden"
      {...(Platform.OS !== 'web'
        ? {
            shadowColor: (shadow as string) ?? palette.overlay,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.16,
            shadowRadius: 10,
            elevation: 3,
          }
        : {})}
    >
      {/* Card body — tappable to open session, long-press to delete on native.
          Web: deal row + delete share a row outside this <button> (Pressable + button) so DOM is valid. */}
      <TouchableOpacity
        onPress={() => onSelect(session.id)}
        onLongPress={Platform.OS !== 'web' ? () => onDelete(session.id) : undefined}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        accessibilityRole="button"
        accessibilityLabel={accessibilityText}
        accessibilityHint={Platform.OS !== 'web' ? 'Long press to delete' : undefined}
        style={{
          width: '100%',
          paddingHorizontal: 18,
          paddingTop: 20,
          paddingBottom: Platform.OS === 'web' ? 12 : 20,
          ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as const) : {}),
        }}
      >
        <YStack gap="$3.5" width="100%" alignItems="flex-start">
          <YStack gap="$2.5" width="100%" alignItems="flex-start">
            <XStack width="100%" justifyContent="space-between" alignItems="center" gap="$3">
              <XStack alignItems="center" gap="$2.5" flex={1} minWidth={0}>
                <YStack
                  width={8}
                  height={8}
                  borderRadius={999}
                  backgroundColor={phaseStyle.accentToken}
                  flexShrink={0}
                />

                <Text
                  fontSize={11}
                  fontWeight="700"
                  color="$placeholderColor"
                  textTransform="uppercase"
                  letterSpacing={1}
                  lineHeight={14}
                  numberOfLines={1}
                  textAlign="left"
                >
                  {phaseLabel(phase)}
                </Text>
              </XStack>

              <XStack alignItems="center" gap="$2" flexShrink={0}>
                <Text fontSize={11} fontWeight="600" color="$placeholderColor" lineHeight={14}>
                  {formatRelativeTime(session.updatedAt)}
                </Text>
              </XStack>
            </XStack>

            <Text
              fontSize={17}
              fontWeight="800"
              color="$color"
              letterSpacing={-0.2}
              textAlign="left"
              width="100%"
            >
              {session.title}
            </Text>

            {previewText ? (
              <Text
                fontSize={14}
                color="$color"
                lineHeight={20}
                opacity={0.72}
                textAlign="left"
                width="100%"
              >
                {previewText}
              </Text>
            ) : (
              <Text
                fontSize={13}
                color="$placeholderColor"
                lineHeight={19}
                textAlign="left"
                width="100%"
              >
                Open this conversation to continue the deal.
              </Text>
            )}
          </YStack>

          <YStack gap="$2" width="100%" alignItems="flex-start">
            <YStack height={1} backgroundColor={dividerColor} />

            {Platform.OS !== 'web' ? (
              <XStack width="100%" alignItems="flex-start">
                {dealSnapshotColumn}
              </XStack>
            ) : null}
          </YStack>
        </YStack>
      </TouchableOpacity>

      {Platform.OS === 'web' ? (
        <XStack
          width="100%"
          paddingHorizontal={18}
          paddingTop={10}
          paddingBottom={12}
          alignItems="flex-start"
          justifyContent="space-between"
          gap="$3"
          backgroundColor="$backgroundStrong"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={accessibilityText}
            onPress={() => onSelect(session.id)}
            style={({ pressed }) => ({
              flex: 1,
              minWidth: 0,
              cursor: 'pointer' as const,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            {dealSnapshotColumn}
          </Pressable>
          <TouchableOpacity
            onPress={() => onDelete(session.id)}
            activeOpacity={0.65}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${session.title}`}
            style={
              {
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
                alignSelf: 'flex-start',
                cursor: 'pointer',
                outlineStyle: 'none',
                outlineWidth: 0,
                boxShadow: 'none',
              } as unknown as import('react-native').ViewStyle
            }
          >
            <Trash2 size={18} color="$placeholderColor" />
          </TouchableOpacity>
        </XStack>
      ) : null}
    </YStack>
  )

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }, { scale: pressScale }] }}>
      {Platform.OS === 'web' ? (
        <HoverLiftFrame shadowColor={shadow as string} borderRadius={18}>
          {card}
        </HoverLiftFrame>
      ) : (
        <View>{card}</View>
      )}
    </Animated.View>
  )
}
