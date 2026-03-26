import { useRef, useEffect } from 'react'
import { Animated, TextInput, TouchableOpacity } from 'react-native'
import { YStack, XStack, Text, useTheme } from 'tamagui'
import { Pencil } from '@tamagui/lucide-icons'
import type { DealNumbers } from '@/lib/types'
import { formatCurrency } from '@/lib/utils'
import { APR_GOOD_THRESHOLD, APR_BAD_THRESHOLD } from '@/lib/constants'
import {
  computeTotalLoanCost,
  computeTotalInterest,
  computeFandIMarkup,
} from '@/lib/dealComputations'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { AppCard } from '@/components/shared'
import { useEditableField } from '@/hooks/useEditableField'

interface KeyNumbersProps {
  numbers: DealNumbers
  phase: string
  preFiPrice: number | null
  onCorrectNumber?: (field: keyof DealNumbers, value: number | null) => void
}

interface NumberRowProps {
  label: string
  value: string
  highlight?: 'good' | 'bad' | 'neutral'
  secondary?: boolean
  fieldKey?: keyof DealNumbers
  rawValue?: number | null
  onCorrect?: (field: keyof DealNumbers, value: number | null) => void
}

function parseNumberInput(raw: string): number | null {
  const cleaned = raw.replace(/[$,%\s]/g, '').replace(/,/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

function NumberRow({
  label,
  value,
  highlight = 'neutral',
  secondary = false,
  fieldKey,
  rawValue,
  onCorrect,
}: NumberRowProps) {
  const flash = useRef(new Animated.Value(0)).current
  const theme = useTheme()
  const editable = !!fieldKey && !!onCorrect

  const { isEditing, editValue, justSaved, startEditing, setEditValue, commitEdit } =
    useEditableField(rawValue?.toString() ?? '', (newVal) => {
      if (fieldKey && onCorrect) {
        onCorrect(fieldKey, parseNumberInput(newVal))
      }
    })

  useEffect(() => {
    if (value !== '—') {
      flash.setValue(1)
      Animated.timing(flash, {
        toValue: 0,
        duration: 600,
        useNativeDriver: USE_NATIVE_DRIVER,
      }).start()
    }
  }, [value, flash])

  const valueColor =
    highlight === 'good' ? '$positive' : highlight === 'bad' ? '$danger' : undefined

  return (
    <Animated.View
      style={{ opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [1, 0.7] }) }}
    >
      <XStack justifyContent="space-between" alignItems="center" paddingVertical="$1.5">
        <Text fontSize={secondary ? 12 : 13} color="$placeholderColor" fontWeight="500">
          {label}
        </Text>
        {isEditing ? (
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
              keyboardType="numeric"
              style={{
                fontSize: secondary ? 12 : 14,
                fontWeight: secondary ? '500' : '700',
                color: theme.color?.val as string,
                textAlign: 'right',
                padding: 0,
                margin: 0,
                minWidth: 60,
              }}
            />
          </XStack>
        ) : editable ? (
          <TouchableOpacity
            onPress={startEditing}
            activeOpacity={0.6}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <XStack alignItems="center" gap="$1.5">
              <Text
                fontSize={secondary ? 12 : 14}
                fontWeight={secondary ? '500' : '700'}
                color={valueColor ?? '$color'}
              >
                {value}
              </Text>
              <Pencil size={10} color="$placeholderColor" opacity={0.5} />
            </XStack>
          </TouchableOpacity>
        ) : (
          <Text
            fontSize={secondary ? 12 : 14}
            fontWeight={secondary ? '500' : '700'}
            color={valueColor ?? '$color'}
          >
            {value}
          </Text>
        )}
      </XStack>
      {justSaved && (
        <Text fontSize={10} color="$brand" textAlign="right" opacity={0.8}>
          Saved — the AI will see this change on your next message
        </Text>
      )}
    </Animated.View>
  )
}

export function KeyNumbers({ numbers, phase, preFiPrice, onCorrectNumber }: KeyNumbersProps) {
  const {
    listingPrice,
    msrp,
    invoicePrice,
    currentOffer,
    yourTarget,
    walkAwayPrice,
    monthlyPayment,
    apr,
    loanTermMonths,
    downPayment,
    tradeInValue,
  } = numbers

  const totalCost = computeTotalLoanCost(numbers)
  const totalInterest = computeTotalInterest(numbers)
  const fiMarkup = phase === 'financing' ? computeFandIMarkup(preFiPrice, currentOffer) : null

  const pricingRows: NumberRowProps[] = []
  if (listingPrice !== null)
    pricingRows.push({
      label: 'Listing Price',
      value: formatCurrency(listingPrice),
      fieldKey: 'listingPrice',
      rawValue: listingPrice,
      onCorrect: onCorrectNumber,
    })
  if (msrp !== null)
    pricingRows.push({
      label: 'MSRP',
      value: formatCurrency(msrp),
      fieldKey: 'msrp',
      rawValue: msrp,
      onCorrect: onCorrectNumber,
    })
  if (invoicePrice !== null)
    pricingRows.push({
      label: 'Invoice',
      value: formatCurrency(invoicePrice),
      fieldKey: 'invoicePrice',
      rawValue: invoicePrice,
      onCorrect: onCorrectNumber,
    })
  if (currentOffer !== null) {
    const highlight =
      yourTarget !== null && currentOffer <= yourTarget
        ? ('good' as const)
        : walkAwayPrice !== null && currentOffer >= walkAwayPrice
          ? ('bad' as const)
          : ('neutral' as const)
    pricingRows.push({
      label: 'Current Offer',
      value: formatCurrency(currentOffer),
      highlight,
      fieldKey: 'currentOffer',
      rawValue: currentOffer,
      onCorrect: onCorrectNumber,
    })
  }
  if (yourTarget !== null)
    pricingRows.push({
      label: 'Your Target',
      value: formatCurrency(yourTarget),
      fieldKey: 'yourTarget',
      rawValue: yourTarget,
      onCorrect: onCorrectNumber,
    })
  if (walkAwayPrice !== null)
    pricingRows.push({
      label: 'Walk-Away',
      value: formatCurrency(walkAwayPrice),
      fieldKey: 'walkAwayPrice',
      rawValue: walkAwayPrice,
      onCorrect: onCorrectNumber,
    })

  const financingRows: NumberRowProps[] = []
  if (apr !== null) {
    const highlight =
      apr <= APR_GOOD_THRESHOLD
        ? ('good' as const)
        : apr >= APR_BAD_THRESHOLD
          ? ('bad' as const)
          : ('neutral' as const)
    financingRows.push({
      label: 'APR',
      value: `${apr}%`,
      highlight,
      fieldKey: 'apr',
      rawValue: apr,
      onCorrect: onCorrectNumber,
    })
  }
  if (monthlyPayment !== null)
    financingRows.push({
      label: 'Monthly',
      value: formatCurrency(monthlyPayment),
      fieldKey: 'monthlyPayment',
      rawValue: monthlyPayment,
      onCorrect: onCorrectNumber,
    })
  if (loanTermMonths !== null)
    financingRows.push({
      label: 'Term',
      value: `${loanTermMonths} months`,
      fieldKey: 'loanTermMonths',
      rawValue: loanTermMonths,
      onCorrect: onCorrectNumber,
    })
  if (downPayment !== null)
    financingRows.push({
      label: 'Down Payment',
      value: formatCurrency(downPayment),
      fieldKey: 'downPayment',
      rawValue: downPayment,
      onCorrect: onCorrectNumber,
    })
  if (totalCost !== null)
    financingRows.push({
      label: 'Total Over Loan',
      value: formatCurrency(totalCost),
      secondary: true,
    })
  if (totalInterest !== null)
    financingRows.push({
      label: 'Total Interest',
      value: formatCurrency(totalInterest),
      highlight: 'bad',
      secondary: true,
    })

  const tradeInRows: NumberRowProps[] = []
  if (tradeInValue !== null)
    tradeInRows.push({
      label: 'Trade-In Value',
      value: formatCurrency(tradeInValue),
      fieldKey: 'tradeInValue',
      rawValue: tradeInValue,
      onCorrect: onCorrectNumber,
    })

  const fiRows: NumberRowProps[] = []
  if (fiMarkup !== null)
    fiRows.push({ label: 'F&I Add-Ons', value: `+${formatCurrency(fiMarkup)}`, highlight: 'bad' })
  if (preFiPrice !== null && phase === 'financing')
    fiRows.push({ label: 'Agreed Price', value: formatCurrency(preFiPrice), secondary: true })

  const allGroups = [
    { key: 'pricing', rows: pricingRows },
    { key: 'financing', rows: financingRows },
    { key: 'tradeIn', rows: tradeInRows },
    { key: 'fi', rows: fiRows },
  ].filter((g) => g.rows.length > 0)

  if (allGroups.length === 0) return null

  return (
    <AppCard accent gap="$1">
      <Text
        fontSize={12}
        fontWeight="600"
        color="$placeholderColor"
        textTransform="uppercase"
        letterSpacing={0.5}
        marginBottom="$1"
      >
        Numbers
      </Text>
      {allGroups.map((group, gi) => (
        <YStack key={group.key}>
          {gi > 0 && <YStack height={1} backgroundColor="$borderColor" marginVertical="$2" />}
          {group.rows.map((row) => (
            <NumberRow key={row.label} {...row} />
          ))}
        </YStack>
      ))}
    </AppCard>
  )
}
