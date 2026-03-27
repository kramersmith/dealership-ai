import { Animated, TouchableOpacity, Platform } from 'react-native'
import { XStack, YStack, Text } from 'tamagui'
import { Trash2 } from '@tamagui/lucide-icons'
import type { DealPhase, DealSummary, Session } from '@/lib/types'
import { DEAL_PHASES } from '@/lib/constants'
import { formatCurrency, stripMarkdown } from '@/lib/utils'
import { useSlideIn } from '@/hooks/useAnimatedValue'

// ─── Phase dot color mapping ───

const PHASE_TOKEN: Record<DealPhase, string> = {
  research: '$placeholderColor',
  initial_contact: '$brand',
  test_drive: '$brand',
  negotiation: '$warning',
  financing: '$warning',
  closing: '$positive',
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
}

export function SessionCard({ session, index, onSelect, onDelete }: SessionCardProps) {
  const { opacity, translateY } = useSlideIn(250, index * 60)
  const phase = session.dealSummary?.phase ?? 'research'
  const phaseDotColor = PHASE_TOKEN[phase] ?? '$placeholderColor'
  const summaryLine = buildSummaryLine(session.dealSummary)
  const accessibilityText = [
    session.title,
    session.dealSummary?.phase ? phaseLabel(session.dealSummary.phase) : null,
    session.lastMessagePreview || null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <XStack
        backgroundColor="$backgroundStrong"
        borderRadius="$3"
        borderWidth={1}
        borderColor="$borderColor"
        alignItems="stretch"
      >
        {/* Card body — tappable to open session, long-press to delete on native */}
        <TouchableOpacity
          onPress={() => onSelect(session.id)}
          onLongPress={Platform.OS !== 'web' ? () => onDelete(session.id) : undefined}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={accessibilityText}
          accessibilityHint={Platform.OS !== 'web' ? 'Long press to delete' : undefined}
          style={{ flex: 1, minHeight: 72, flexDirection: 'row', padding: 12, gap: 12 }}
        >
          {/* Phase dot */}
          <YStack paddingTop={4}>
            <YStack
              width={10}
              height={10}
              borderRadius={100}
              backgroundColor={phaseDotColor}
              accessibilityLabel={
                session.dealSummary?.phase ? phaseLabel(session.dealSummary.phase) : 'No phase'
              }
            />
          </YStack>

          {/* Content */}
          <YStack flex={1} gap="$1">
            {/* Title + timestamp row */}
            <XStack justifyContent="space-between" alignItems="center">
              <Text
                fontSize={16}
                fontWeight="700"
                color="$color"
                flex={1}
                numberOfLines={1}
                marginRight="$2"
              >
                {session.title}
              </Text>
              <Text fontSize={11} color="$placeholderColor" flexShrink={0}>
                {formatRelativeTime(session.updatedAt)}
              </Text>
            </XStack>

            {/* Message preview */}
            {session.lastMessagePreview ? (
              <Text fontSize={13} color="$placeholderColor" numberOfLines={2} lineHeight={18}>
                {stripMarkdown(session.lastMessagePreview)}
              </Text>
            ) : null}

            {/* Deal summary line */}
            {summaryLine ? (
              <Text fontSize={11} color="$placeholderColor" numberOfLines={1} opacity={0.7}>
                {summaryLine}
              </Text>
            ) : null}
          </YStack>
        </TouchableOpacity>

        {/* Delete button — outside the card TouchableOpacity to avoid nested buttons on web */}
        {Platform.OS === 'web' && (
          <TouchableOpacity
            onPress={() => onDelete(session.id)}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${session.title}`}
            style={{
              width: 44,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Trash2 size={16} color="$placeholderColor" />
          </TouchableOpacity>
        )}
      </XStack>
    </Animated.View>
  )
}
