import { useRef, useEffect, useState } from 'react'
import { Animated } from 'react-native'
import { XStack, YStack, Text } from 'tamagui'
import { AppCard } from '@/components/shared'
import {
  insightCardBodyProps,
  insightCardRowLabelProps,
  insightCardSecondaryProps,
  insightCardSectionLabelProps,
} from '@/lib/insightsPanelTypography'
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
    // Only animate if the value actually changed
    if (prevTargetRef.current === targetValue) return
    prevTargetRef.current = targetValue

    // Clean up previous listener
    if (listenerRef.current) {
      animValue.removeListener(listenerRef.current)
    }

    // Add listener to update display text during animation
    listenerRef.current = animValue.addListener(({ value: v }) => {
      setDisplayText(`${prefix}${formatNumber(v, hasDecimals)}${suffix}`)
    })

    Animated.timing(animValue, {
      toValue: targetValue,
      duration: MORPH_DURATION,
      useNativeDriver: false, // text content requires JS driver
    }).start(({ finished }) => {
      if (finished) {
        // Ensure final value is exact
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

  // Update display when prefix/suffix changes without animation
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

// ─── Numbers Card ───

export function NumbersCard({ title, content }: NumbersCardProps) {
  const groups = (content.groups as NumberGroup[]) ?? []
  const rows = (content.rows as NumberRow[]) ?? []
  const summary = typeof content.summary === 'string' ? content.summary.trim() : ''

  const allGroups: NumberGroup[] =
    groups.length > 0 ? groups : rows.length > 0 ? [{ key: 'default', rows }] : []

  if (allGroups.length === 0) return null

  return (
    <AppCard compact>
      <YStack gap="$3">
        <CardTitle>{title}</CardTitle>
        {summary ? <Text {...insightCardBodyProps}>{summary}</Text> : null}

        {allGroups.map((group, gi) => {
          const groupLabel = formatGroupLabel(group.key)
          return (
            <YStack key={group.key}>
              {gi > 0 && <YStack height={1} backgroundColor="$borderColor" marginVertical="$2" />}
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
        })}
      </YStack>
    </AppCard>
  )
}
