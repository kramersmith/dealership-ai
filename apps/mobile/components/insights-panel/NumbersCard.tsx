import { useRef, useEffect, useState } from 'react'
import { Animated } from 'react-native'
import { XStack, YStack, Text } from 'tamagui'
import { Target } from '@tamagui/lucide-icons'
import { AppCard } from '@/components/shared'
import {
  insightCardBodyProps,
  insightCardRowLabelProps,
  insightCardSecondaryProps,
  insightCardSectionLabelProps,
} from '@/lib/insightsPanelTypography'
import { palette } from '@/lib/theme/tokens'
import type { AiCardKind } from '@/lib/types'
import { CardTitle } from './CardTitle'

// ─── Types ───

interface NumberRow {
  label: string
  value: string
  field?: string
  highlight?: 'good' | 'bad' | 'neutral'
  secondary?: boolean
}

interface NumberGroup {
  key: string
  rows: NumberRow[]
}

interface NumbersCardProps {
  title: string
  content: Record<string, any>
  kind?: AiCardKind
}

function formatGroupLabel(key: string): string | null {
  const normalized = key.trim()
  if (!normalized || normalized === 'default') return null

  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

// ─── Number Parsing ───

/** Extract numeric value, prefix (e.g. "$"), and suffix from a formatted string. */
function parseFormattedNumber(value: string): {
  numeric: number
  prefix: string
  suffix: string
  isNumeric: boolean
  hasDecimals: boolean
} {
  // Match optional prefix, number (with commas/decimals), optional suffix
  const match = value.match(/^([^0-9.-]*)(-?[\d,]+\.?\d*)(.*)$/)
  if (!match) {
    return { numeric: 0, prefix: '', suffix: '', isNumeric: false, hasDecimals: false }
  }

  const prefix = match[1]
  const numStr = match[2].replace(/,/g, '')
  const suffix = match[3]
  const numeric = parseFloat(numStr)

  if (isNaN(numeric)) {
    return { numeric: 0, prefix: '', suffix: '', isNumeric: false, hasDecimals: false }
  }

  const hasDecimals = numStr.includes('.')
  return { numeric, prefix, suffix, isNumeric: true, hasDecimals }
}

/** Format a number with commas and optional decimals to match the original format. */
function formatNumber(value: number, hasDecimals: boolean): string {
  if (hasDecimals) {
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }
  return Math.round(value).toLocaleString('en-US')
}

// ─── Animated Number Display ───

const MORPH_DURATION = 600

function AnimatedNumberValue({
  value,
  color,
  fontSize,
  fontWeight,
}: {
  value: string
  color?: string
  fontSize: number
  fontWeight: string
}) {
  const parsed = parseFormattedNumber(value)

  // For non-numeric values, render plain text
  if (!parsed.isNumeric) {
    return (
      <Text fontSize={fontSize} fontWeight={fontWeight as any} color={color ?? '$color'}>
        {value}
      </Text>
    )
  }

  return (
    <AnimatedCounter
      targetValue={parsed.numeric}
      prefix={parsed.prefix}
      suffix={parsed.suffix}
      hasDecimals={parsed.hasDecimals}
      color={color}
      fontSize={fontSize}
      fontWeight={fontWeight}
    />
  )
}

function AnimatedCounter({
  targetValue,
  prefix,
  suffix,
  hasDecimals,
  color,
  fontSize,
  fontWeight,
}: {
  targetValue: number
  prefix: string
  suffix: string
  hasDecimals: boolean
  color?: string
  fontSize: number
  fontWeight: string
}) {
  const animValue = useRef(new Animated.Value(targetValue)).current
  const [displayText, setDisplayText] = useState(
    `${prefix}${formatNumber(targetValue, hasDecimals)}${suffix}`
  )
  const listenerRef = useRef<string | null>(null)
  const prevTargetRef = useRef(targetValue)

  useEffect(() => {
    if (prevTargetRef.current === targetValue) return
    prevTargetRef.current = targetValue

    if (listenerRef.current) {
      animValue.removeListener(listenerRef.current)
    }

    listenerRef.current = animValue.addListener(({ value: v }) => {
      setDisplayText(`${prefix}${formatNumber(v, hasDecimals)}${suffix}`)
    })

    Animated.timing(animValue, {
      toValue: targetValue,
      duration: MORPH_DURATION,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        setDisplayText(`${prefix}${formatNumber(targetValue, hasDecimals)}${suffix}`)
      }
    })

    return () => {
      if (listenerRef.current) {
        animValue.removeListener(listenerRef.current)
        listenerRef.current = null
      }
    }
  }, [targetValue, prefix, suffix, hasDecimals, animValue])

  useEffect(() => {
    setDisplayText(`${prefix}${formatNumber(targetValue, hasDecimals)}${suffix}`)
  }, [prefix, suffix, hasDecimals, targetValue])

  return (
    <Text fontSize={fontSize} fontWeight={fontWeight as any} color={color ?? '$color'}>
      {displayText}
    </Text>
  )
}

// ─── Number Row ───

function NumberRowItem({ row }: { row: NumberRow }) {
  const isSecondary = !!row.secondary

  const valueColor =
    row.highlight === 'good' ? '$positive' : row.highlight === 'bad' ? '$danger' : undefined

  return (
    <XStack justifyContent="space-between" alignItems="center" paddingVertical="$1.5">
      <Text {...(isSecondary ? insightCardSecondaryProps : insightCardRowLabelProps)}>
        {row.label}
      </Text>
      <AnimatedNumberValue
        value={row.value}
        color={valueColor}
        fontSize={isSecondary ? 12 : insightCardBodyProps.fontSize}
        fontWeight={isSecondary ? '600' : '700'}
      />
    </XStack>
  )
}

// ─── Deal Overview Header ───

function findRow(rows: NumberRow[], field: string): NumberRow | undefined {
  return rows.find((row) => row.field === field)
}

function rowToNumeric(row: NumberRow | undefined): number | null {
  if (!row) return null
  const parsed = parseFormattedNumber(row.value)
  return parsed.isNumeric ? parsed.numeric : null
}

function formatSignedDelta(delta: number): { label: string; isSavings: boolean } {
  // Delta = current_offer - msrp (negative = below MSRP = good)
  const isSavings = delta <= 0
  const abs = Math.abs(Math.round(delta))
  const formatted = `$${abs.toLocaleString('en-US')}`
  return { label: `${delta < 0 ? '-' : delta > 0 ? '+' : ''}${formatted}`, isSavings }
}

function DealOverviewHeader({
  currentOffer,
  msrp,
  listingPrice,
  target,
}: {
  currentOffer: NumberRow
  msrp?: NumberRow
  listingPrice?: NumberRow
  target?: NumberRow
}) {
  const offerNumeric = rowToNumeric(currentOffer)
  const msrpRow = msrp ?? listingPrice
  const msrpNumeric = rowToNumeric(msrpRow)
  const targetNumeric = rowToNumeric(target)

  const delta = offerNumeric != null && msrpNumeric != null ? offerNumeric - msrpNumeric : null
  const deltaInfo = delta != null ? formatSignedDelta(delta) : null

  // Progress: 0 at MSRP, 1 at target (or further). Closer to target = fuller bar.
  let progress = 0
  if (offerNumeric != null && msrpNumeric != null && targetNumeric != null) {
    const span = msrpNumeric - targetNumeric
    if (span > 0) {
      progress = Math.max(0, Math.min(1, (msrpNumeric - offerNumeric) / span))
    }
  } else if (offerNumeric != null && msrpNumeric != null && offerNumeric < msrpNumeric) {
    // No target — show partial fill proportional to MSRP discount up to 10%
    progress = Math.min(1, (msrpNumeric - offerNumeric) / (msrpNumeric * 0.1))
  }

  return (
    <YStack gap="$2">
      <XStack justifyContent="space-between" alignItems="flex-start" gap="$3">
        <YStack flex={1} minWidth={0} gap="$0.5">
          <Text {...insightCardSectionLabelProps}>Current offer</Text>
          <AnimatedNumberValue value={currentOffer.value} fontSize={26} fontWeight="800" />
        </YStack>
        {deltaInfo ? (
          <YStack alignItems="flex-end" gap="$0.5">
            <Text {...insightCardSectionLabelProps}>vs MSRP</Text>
            <Text
              fontSize={20}
              fontWeight="800"
              color={deltaInfo.isSavings ? '$positive' : '$danger'}
            >
              {deltaInfo.label}
            </Text>
          </YStack>
        ) : null}
      </XStack>

      {progress > 0 ? (
        <YStack
          height={4}
          borderRadius={3}
          backgroundColor="rgba(148, 163, 184, 0.18)"
          overflow="hidden"
        >
          <YStack
            height={4}
            borderRadius={3}
            backgroundColor={palette.copilotEmerald}
            style={{ width: `${Math.round(progress * 100)}%` } as any}
          />
        </YStack>
      ) : null}

      {target || msrpRow ? (
        <XStack justifyContent="space-between" alignItems="center">
          <Text {...insightCardSecondaryProps}>{target ? `Target ${target.value}` : ' '}</Text>
          <Text {...insightCardSecondaryProps}>{msrpRow ? `MSRP ${msrpRow.value}` : ' '}</Text>
        </XStack>
      ) : null}
    </YStack>
  )
}

// ─── Numbers Card ───

const HEADER_FIELDS = new Set(['current_offer', 'msrp', 'listing_price', 'your_target'])

export function NumbersCard({ title, content }: NumbersCardProps) {
  const groups = (content.groups as NumberGroup[]) ?? []
  const rows = (content.rows as NumberRow[]) ?? []
  const summary = typeof content.summary === 'string' ? content.summary.trim() : ''

  const allGroups: NumberGroup[] =
    groups.length > 0 ? groups : rows.length > 0 ? [{ key: 'default', rows }] : []

  if (allGroups.length === 0) return null

  // Detect Deal Overview shape: a single default group containing current_offer + (msrp|listing_price|your_target)
  const flatRows: NumberRow[] = groups.length > 0 ? groups.flatMap((group) => group.rows) : rows
  const currentOffer = findRow(flatRows, 'current_offer')
  const msrp = findRow(flatRows, 'msrp')
  const listingPrice = findRow(flatRows, 'listing_price')
  const target = findRow(flatRows, 'your_target')
  const showOverviewHeader =
    !!currentOffer && (!!msrp || !!listingPrice || !!target) && groups.length === 0

  const remainingRows = showOverviewHeader
    ? flatRows.filter((row) => !row.field || !HEADER_FIELDS.has(row.field))
    : null

  return (
    <AppCard
      header={
        <CardTitle
          icon={<Target size={12} color={palette.copilotEmerald} />}
          iconAccent={palette.copilotEmerald}
        >
          {title}
        </CardTitle>
      }
    >
      <YStack gap="$3">
        {summary ? <Text {...insightCardBodyProps}>{summary}</Text> : null}

        {showOverviewHeader && currentOffer ? (
          <DealOverviewHeader
            currentOffer={currentOffer}
            msrp={msrp}
            listingPrice={listingPrice}
            target={target}
          />
        ) : null}

        {showOverviewHeader && remainingRows && remainingRows.length > 0 ? (
          <YStack paddingTop="$2" borderTopWidth={1} borderTopColor="$borderColor" opacity={0.95}>
            {remainingRows.map((row) => (
              <NumberRowItem key={`${row.field ?? row.label}`} row={row} />
            ))}
          </YStack>
        ) : null}

        {!showOverviewHeader
          ? allGroups.map((group, gi) => {
              const groupLabel = formatGroupLabel(group.key)
              return (
                <YStack key={group.key}>
                  {gi > 0 && (
                    <YStack height={1} backgroundColor="$borderColor" marginVertical="$2" />
                  )}
                  {groupLabel ? (
                    <Text {...insightCardSectionLabelProps} paddingBottom="$1">
                      {groupLabel}
                    </Text>
                  ) : null}
                  {group.rows.map((row) => (
                    <NumberRowItem key={row.label} row={row} />
                  ))}
                </YStack>
              )
            })
          : null}
      </YStack>
    </AppCard>
  )
}
