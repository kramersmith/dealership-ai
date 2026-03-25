import { useRef, useEffect } from 'react'
import { Animated, Platform } from 'react-native'
const useNative = Platform.OS !== 'web'
import { XStack, YStack, Text } from 'tamagui'
import type { DealNumbers } from '@/lib/types'
import { formatCurrency, formatPercent } from '@/lib/utils'
import { APR_GOOD_THRESHOLD, APR_BAD_THRESHOLD } from '@/lib/constants'
import { colors } from '@/lib/colors'
import { AppCard } from '@/components/shared'

interface NumbersDashboardProps {
  numbers: DealNumbers
}

interface NumberCellProps {
  label: string
  value: string
  highlight?: 'good' | 'bad' | 'neutral'
}

function NumberCell({ label, value, highlight = 'neutral' }: NumberCellProps) {
  const flash = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (value !== '—') {
      flash.setValue(1)
      Animated.timing(flash, {
        toValue: 0,
        duration: 600,
        useNativeDriver: useNative,
      }).start()
    }
  }, [value])

  const valueColor =
    highlight === 'good' ? colors.positive : highlight === 'bad' ? colors.danger : undefined

  return (
    <YStack flex={1} gap="$1">
      <Text fontSize={11} color="$placeholderColor" fontWeight="500" numberOfLines={1}>
        {label}
      </Text>
      <Animated.View style={{ opacity: Animated.subtract(1, Animated.multiply(flash, 0.3)) }}>
        <Text fontSize={17} fontWeight="700" color={valueColor ?? '$color'} numberOfLines={1}>
          {value}
        </Text>
      </Animated.View>
    </YStack>
  )
}

export function NumbersDashboard({ numbers }: NumbersDashboardProps) {
  const { msrp, listingPrice, yourTarget, walkAwayPrice, currentOffer, monthlyPayment, apr } =
    numbers

  const offerHighlight =
    currentOffer === null || yourTarget === null
      ? 'neutral'
      : currentOffer <= yourTarget
        ? 'good'
        : walkAwayPrice !== null && currentOffer > walkAwayPrice
          ? 'bad'
          : 'neutral'

  const aprHighlight =
    apr === null
      ? 'neutral'
      : apr <= APR_GOOD_THRESHOLD
        ? 'good'
        : apr >= APR_BAD_THRESHOLD
          ? 'bad'
          : 'neutral'

  return (
    <AppCard gap="$3">
      <XStack gap="$4">
        <NumberCell label="Listing Price" value={formatCurrency(listingPrice)} />
        <NumberCell label="MSRP" value={formatCurrency(msrp)} />
        <NumberCell label="Your Target" value={formatCurrency(yourTarget)} highlight="good" />
      </XStack>
      <XStack gap="$4">
        <NumberCell label="Walk-Away" value={formatCurrency(walkAwayPrice)} highlight="bad" />
        <NumberCell
          label="Current Offer"
          value={formatCurrency(currentOffer)}
          highlight={offerHighlight}
        />
        <NumberCell label="Monthly" value={formatCurrency(monthlyPayment)} />
      </XStack>
      <XStack gap="$4">
        <NumberCell label="APR" value={formatPercent(apr)} highlight={aprHighlight} />
      </XStack>
    </AppCard>
  )
}
