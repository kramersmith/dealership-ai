import { useRef, useEffect, useCallback } from 'react'
import {
  Animated,
  Pressable,
  TouchableOpacity,
  Platform,
  View,
  Text as RNText,
} from 'react-native'
import { Trash2 } from '@tamagui/lucide-icons'
import { useTheme } from 'tamagui'
import type { DealPhase, DealSummary, Session } from '@/lib/types'
import { DEAL_PHASES } from '@/lib/constants'
import { formatCurrency, stripMarkdown } from '@/lib/utils'
import { HoverLiftFrame } from '@/components/shared/HoverLiftFrame'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { palette } from '@/lib/theme/tokens'
import { darkTheme } from '@/lib/theme/themes'

// NOTE: Layout uses RN View/Text only (no Tamagui YStack/XStack/Text). Tamagui web + VirtualizedList
// can JSON.stringify theme context during class serialization (circular Provider graph).

// ─── Phase styling ───

function phaseLabel(phase: DealPhase): string {
  return DEAL_PHASES.find((p) => p.key === phase)?.label ?? phase.replace(/_/g, ' ')
}

function phaseAccentColor(theme: ReturnType<typeof useTheme>, phase: DealPhase): string {
  const placeholder = (theme.placeholderColor?.val as string | undefined) ?? '#888'
  const brand = (theme.brand?.val as string | undefined) ?? palette.brand
  const warning = (theme.warning?.val as string | undefined) ?? palette.warning
  const positive = (theme.positive?.val as string | undefined) ?? palette.positive
  switch (phase) {
    case 'research':
      return placeholder
    case 'initial_contact':
    case 'test_drive':
      return brand
    case 'negotiation':
    case 'financing':
      return warning
    case 'closing':
      return positive
    default:
      return placeholder
  }
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
  const phaseAccent = phaseAccentColor(theme, phase)
  const summaryLine = buildSummaryLine(session.dealSummary)
  const previewText = session.lastMessagePreview ? stripMarkdown(session.lastMessagePreview) : null
  const shadow = theme.shadowColor?.val ?? palette.overlay
  const isDarkTheme = theme.background?.val === darkTheme.background
  const dividerColor = isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(28,30,33,0.08)'
  const placeholderVal = (theme.placeholderColor?.val as string | undefined) ?? '#888'
  const colorVal = (theme.color?.val as string | undefined) ?? '#1C1E21'
  const bgStrong = (theme.backgroundStrong?.val as string | undefined) ?? '#fff'
  const borderCol = (theme.borderColor?.val as string | undefined) ?? 'rgba(0,0,0,0.08)'

  const accessibilityText = [
    session.title,
    session.dealSummary?.phase ? phaseLabel(session.dealSummary.phase) : null,
    session.lastMessagePreview || null,
  ]
    .filter(Boolean)
    .join(', ')

  const dealSnapshotColumn = (
    <View style={{ flex: 1, minWidth: 0, gap: 4, alignItems: 'flex-start' }}>{[
      <RNText
        key="ds-label"
        style={{
          fontSize: 10,
          fontWeight: '700',
          color: phaseAccent,
          textTransform: 'uppercase',
          letterSpacing: 0.9,
          textAlign: 'left',
        }}
      >
        Deal snapshot
      </RNText>,
      <RNText
        key="ds-body"
        style={{
          fontSize: 12,
          color: placeholderVal,
          opacity: 0.88,
          textAlign: 'left',
          width: '100%',
        }}
      >
        {summaryLine ?? 'Continue the conversation'}
      </RNText>,
    ]}</View>
  )

  const cardStyle = {
    width: '100%' as const,
    backgroundColor: bgStrong,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: borderCol,
    overflow: 'hidden' as const,
    ...(Platform.OS !== 'web'
      ? {
          shadowColor: (shadow as string) ?? palette.overlay,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.16,
          shadowRadius: 10,
          elevation: 3,
        }
      : {}),
  }

  const card = (
    <View style={cardStyle}>{[
      <TouchableOpacity
        key="open"
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
      ><View style={{ width: '100%', gap: 14, alignItems: 'flex-start' }}>{[
          <View key="top" style={{ width: '100%', gap: 10, alignItems: 'flex-start' }}>{[
            <View
              key="hdr"
              style={{
                width: '100%',
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >{[
              <View
                key="hdr-l"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}
              >{[
                <View
                  key="dot"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    backgroundColor: phaseAccent,
                    flexShrink: 0,
                  }}
                />,
                <RNText
                  key="phase"
                  style={{
                    fontSize: 11,
                    fontWeight: '700',
                    color: placeholderVal,
                    textTransform: 'uppercase',
                    letterSpacing: 1,
                    lineHeight: 14,
                    flexShrink: 1,
                    textAlign: 'left',
                  }}
                  numberOfLines={1}
                >
                  {phaseLabel(phase)}
                </RNText>,
              ]}</View>,
              <View key="hdr-r" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <RNText style={{ fontSize: 11, fontWeight: '600', color: placeholderVal, lineHeight: 14 }}>
                  {formatRelativeTime(session.updatedAt)}
                </RNText>
              </View>,
            ]}</View>,
            <RNText
              key="title"
              style={{
                fontSize: 17,
                fontWeight: '800',
                color: colorVal,
                letterSpacing: -0.2,
                textAlign: 'left',
                width: '100%',
              }}
            >
              {session.title}
            </RNText>,
            previewText ? (
              <RNText
                key="prev"
                style={{
                  fontSize: 14,
                  color: colorVal,
                  lineHeight: 20,
                  opacity: 0.72,
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                {previewText}
              </RNText>
            ) : (
              <RNText
                key="prev-empty"
                style={{
                  fontSize: 13,
                  color: placeholderVal,
                  lineHeight: 19,
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                Open this conversation to continue the deal.
              </RNText>
            ),
          ]}</View>,
          <View key="divider-block" style={{ width: '100%', gap: 8, alignItems: 'flex-start' }}>{[
            <View key="rule" style={{ height: 1, width: '100%', backgroundColor: dividerColor }} />,
            Platform.OS !== 'web' ? (
              <View key="snap-n" style={{ width: '100%', flexDirection: 'row', alignItems: 'flex-start' }}>{dealSnapshotColumn}</View>
            ) : null,
          ]}</View>,
        ]}</View></TouchableOpacity>,
      Platform.OS === 'web' ? (
        <View
          key="web-actions"
          style={{
            width: '100%',
            paddingHorizontal: 18,
            paddingTop: 10,
            paddingBottom: 12,
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            backgroundColor: bgStrong,
          }}
        >{[
          <Pressable
            key="snap-press"
            accessibilityRole="button"
            accessibilityLabel={accessibilityText}
            onPress={() => onSelect(session.id)}
            style={({ pressed }) => ({
              flex: 1,
              minWidth: 0,
              cursor: 'pointer' as const,
              opacity: pressed ? 0.85 : 1,
            })}
          >{dealSnapshotColumn}</Pressable>,
          <TouchableOpacity
            key="del"
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
          ><Trash2 size={18} color={placeholderVal} /></TouchableOpacity>,
        ]}</View>
      ) : null,
    ]}</View>
  )

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }, { scale: pressScale }] }}>{[
      Platform.OS === 'web' ? (
        <HoverLiftFrame key="lift" shadowColor={shadow as string} borderRadius={18}>{card}</HoverLiftFrame>
      ) : (
        <View key="wrap">{card}</View>
      ),
    ]}</Animated.View>
  )
}
