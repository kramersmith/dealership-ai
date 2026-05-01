import { memo, useCallback, useState } from 'react'
import { Animated, Platform } from 'react-native'
import { YStack, XStack, Text, Spinner } from 'tamagui'
import { ScanLine } from '@tamagui/lucide-icons'

import type { VinAssistItem } from '@/lib/types'
import { CHAT_BUBBLE_MAX_WIDTH, MONO_FONT_FAMILY } from '@/lib/constants'
import { AppButton, AppCard } from '@/components/shared'
import { CardTitle } from '@/components/insights-panel/CardTitle'
import { useFadeIn } from '@/hooks/useAnimatedValue'
import { useScreenWidth } from '@/hooks/useScreenWidth'
import { useChatStore } from '@/stores/chatStore'
import { vinAssistVehicleLabel as vehicleLabel } from './vinAssistUtils'

function isRowComplete(status: VinAssistItem['status']): boolean {
  return status === 'confirmed' || status === 'skipped' || status === 'rejected'
}

function rowStatusMeta(status: VinAssistItem['status']): {
  label: string
  tone: 'brand' | 'muted' | 'positive' | 'warning' | 'danger'
} {
  switch (status) {
    case 'decoding':
      return { label: 'Decoding…', tone: 'brand' }
    case 'decoded':
      return { label: 'Confirm', tone: 'warning' }
    case 'confirmed':
      return { label: 'Done', tone: 'positive' }
    case 'skipped':
      return { label: 'Skipped', tone: 'muted' }
    case 'rejected':
      return { label: 'Rejected', tone: 'muted' }
    case 'failed':
      return { label: 'Error', tone: 'danger' }
    default:
      return { label: 'Pending', tone: 'warning' }
  }
}

function StatusChip({ status }: { status: VinAssistItem['status'] }) {
  const { label, tone } = rowStatusMeta(status)
  const color =
    tone === 'positive'
      ? '$positive'
      : tone === 'warning'
        ? '$warning'
        : tone === 'danger'
          ? '$danger'
          : tone === 'brand'
            ? '$brand'
            : '$placeholderColor'

  if (status === 'decoding') {
    return (
      <XStack alignItems="center" gap="$1.5" paddingVertical="$1">
        <Spinner size="small" color="$brand" />
        <Text fontSize={11} fontWeight="700" color="$brand" letterSpacing={0.3}>
          {label.toUpperCase()}
        </Text>
      </XStack>
    )
  }

  return (
    <XStack
      backgroundColor="$backgroundHover"
      borderRadius={100}
      paddingHorizontal="$2.5"
      paddingVertical="$1"
      alignItems="center"
    >
      <Text fontSize={11} fontWeight="700" color={color} letterSpacing={0.3}>
        {label.toUpperCase()}
      </Text>
    </XStack>
  )
}

// All VIN renderings across the app share the JetBrains Mono stack so VINs
// read as machine-encoded identifiers. See `MONO_FONT_FAMILY` in lib/constants.
const vinFont = MONO_FONT_FAMILY

/** One section inside the single VIN-assist card (not a nested card). */
const VinAssistSection = memo(function VinAssistSection({
  item,
  index,
  total,
  isFirst,
  buttonsInline,
  hideDecodedConfirm,
  bulkConfirmInProgress,
}: {
  item: VinAssistItem
  index: number
  total: number
  isFirst: boolean
  buttonsInline: boolean
  /** When several VINs are decoded, parent shows one "confirm all" — hide per-row confirm. */
  hideDecodedConfirm: boolean
  bulkConfirmInProgress: boolean
}) {
  const skipVinAssist = useChatStore((state) => state.skipVinAssist)
  const decodeVinAssist = useChatStore((state) => state.decodeVinAssist)
  const confirmVinAssist = useChatStore((state) => state.confirmVinAssist)
  const rejectVinAssist = useChatStore((state) => state.rejectVinAssist)

  const [confirming, setConfirming] = useState(false)
  const [rejecting, setRejecting] = useState(false)

  const handleConfirm = useCallback(async () => {
    setConfirming(true)
    try {
      await confirmVinAssist(item.id)
    } finally {
      setConfirming(false)
    }
  }, [confirmVinAssist, item.id])

  const handleReject = useCallback(async () => {
    setRejecting(true)
    try {
      await rejectVinAssist(item.id)
    } finally {
      setRejecting(false)
    }
  }, [rejectVinAssist, item.id])

  const helperLine =
    item.status === 'decoded' || item.status === 'confirmed'
      ? hideDecodedConfirm && item.status === 'decoded'
        ? 'Wrong for this VIN? Reject below. Otherwise use confirm both at the bottom.'
        : 'Match the window sticker? Confirm so we use this vehicle in your thread.'
      : item.status === 'failed'
        ? (item.error ?? 'Tap Decode to retry, or skip.')
        : item.status === 'skipped'
          ? 'You can decode this VIN later from this card.'
          : item.status === 'rejected'
            ? 'Unverified until you decode again.'
            : 'Decode for year, make, and model.'

  const buttonFlexStyle = buttonsInline
    ? ({ flex: 1, minWidth: 0 } as const)
    : ({ width: '100%' as const } as const)

  return (
    <YStack
      gap="$2"
      paddingTop={isFirst ? 0 : '$2.5'}
      marginTop={isFirst ? 0 : '$4'}
      borderTopWidth={isFirst ? 0 : 1}
      borderTopColor="$borderColor"
    >
      <XStack justifyContent="space-between" alignItems="flex-start" gap="$2">
        <YStack flex={1} flexShrink={1} gap="$1">
          <Text fontSize={11} fontWeight="700" color="$placeholderColor" letterSpacing={0.5}>
            VIN {index + 1} OF {total}
          </Text>
          <Text
            fontSize={14}
            fontWeight="700"
            color="$color"
            letterSpacing={0.5}
            fontFamily={vinFont}
            {...(Platform.OS === 'web'
              ? ({
                  style: { userSelect: 'text' },
                } as any)
              : { selectable: true })}
          >
            {item.vin}
          </Text>
        </YStack>
        <StatusChip status={item.status} />
      </XStack>

      {(item.status === 'decoded' || item.status === 'confirmed') &&
      vehicleLabel(item) !== item.vin ? (
        <YStack gap="$1">
          <Text fontSize={12} fontWeight="600" color="$placeholderColor">
            Decoded as
          </Text>
          <Text fontSize={14} fontWeight="600" color="$color" lineHeight={20}>
            {vehicleLabel(item)}
          </Text>
          {item.decodedVehicle?.partial ? (
            <Text fontSize={12} color="$placeholderColor" lineHeight={18}>
              Some fields may be incomplete.
            </Text>
          ) : null}
        </YStack>
      ) : null}

      <Text fontSize={12} color="$placeholderColor" lineHeight={18}>
        {helperLine}
      </Text>

      {item.status === 'detected' || item.status === 'skipped' || item.status === 'failed' ? (
        buttonsInline && item.status === 'detected' ? (
          <XStack width="100%" gap="$2" alignItems="stretch">
            <AppButton
              minHeight={44}
              {...buttonFlexStyle}
              onPress={() => decodeVinAssist(item.id)}
              accessibilityLabel={`Decode VIN ${item.vin}`}
            >
              Decode VIN
            </AppButton>
            <AppButton
              minHeight={44}
              {...buttonFlexStyle}
              variant="outline"
              onPress={() => skipVinAssist(item.id)}
              accessibilityLabel={`Skip decode for VIN ${item.vin}`}
            >
              Skip for now
            </AppButton>
          </XStack>
        ) : (
          <YStack gap="$2" width="100%" alignItems="stretch">
            <AppButton
              minHeight={44}
              width="100%"
              onPress={() => decodeVinAssist(item.id)}
              accessibilityLabel={`Decode VIN ${item.vin}`}
            >
              Decode VIN
            </AppButton>
            {item.status === 'detected' ? (
              <AppButton
                minHeight={44}
                width="100%"
                variant="outline"
                onPress={() => skipVinAssist(item.id)}
                accessibilityLabel={`Skip decode for VIN ${item.vin}`}
              >
                Skip for now
              </AppButton>
            ) : null}
          </YStack>
        )
      ) : null}

      {item.status === 'decoded' && hideDecodedConfirm ? (
        <AppButton
          minHeight={44}
          width="100%"
          variant="outline"
          onPress={handleReject}
          disabled={rejecting || bulkConfirmInProgress}
          accessibilityLabel={`Reject decode for VIN ${item.vin}`}
        >
          {rejecting ? (
            <XStack alignItems="center" gap="$2" justifyContent="center">
              <Spinner size="small" color="$placeholderColor" />
              <Text color="$placeholderColor" fontSize={14}>
                Rejecting…
              </Text>
            </XStack>
          ) : (
            "No, that's not right"
          )}
        </AppButton>
      ) : item.status === 'decoded' ? (
        buttonsInline ? (
          <XStack width="100%" gap="$2" alignItems="stretch">
            <AppButton
              minHeight={44}
              {...buttonFlexStyle}
              onPress={handleConfirm}
              disabled={confirming || rejecting}
              accessibilityLabel="Confirm decoded vehicle"
            >
              {confirming ? (
                <XStack alignItems="center" gap="$2">
                  <Spinner size="small" color="$white" />
                  <Text color="$white" fontSize={14} fontWeight="600">
                    Confirming…
                  </Text>
                </XStack>
              ) : (
                'Yes, use this vehicle'
              )}
            </AppButton>
            <AppButton
              minHeight={44}
              {...buttonFlexStyle}
              variant="outline"
              onPress={handleReject}
              disabled={confirming || rejecting}
              accessibilityLabel="Reject decoded vehicle"
            >
              {rejecting ? (
                <XStack alignItems="center" gap="$2" justifyContent="center">
                  <Spinner size="small" color="$placeholderColor" />
                  <Text color="$placeholderColor" fontSize={14}>
                    Rejecting…
                  </Text>
                </XStack>
              ) : (
                "No, that's not right"
              )}
            </AppButton>
          </XStack>
        ) : (
          <YStack gap="$2" width="100%" alignItems="stretch">
            <AppButton
              minHeight={44}
              width="100%"
              onPress={handleConfirm}
              disabled={confirming || rejecting}
              accessibilityLabel="Confirm decoded vehicle"
            >
              {confirming ? (
                <XStack alignItems="center" gap="$2">
                  <Spinner size="small" color="$white" />
                  <Text color="$white" fontSize={14} fontWeight="600">
                    Confirming…
                  </Text>
                </XStack>
              ) : (
                'Yes, use this vehicle'
              )}
            </AppButton>
            <AppButton
              minHeight={44}
              width="100%"
              variant="outline"
              onPress={handleReject}
              disabled={confirming || rejecting}
              accessibilityLabel="Reject decoded vehicle"
            >
              {rejecting ? (
                <XStack alignItems="center" gap="$2" justifyContent="center">
                  <Spinner size="small" color="$placeholderColor" />
                  <Text color="$placeholderColor" fontSize={14}>
                    Rejecting…
                  </Text>
                </XStack>
              ) : (
                "No, that's not right"
              )}
            </AppButton>
          </YStack>
        )
      ) : null}
    </YStack>
  )
})

export const MultiVinAssistCard = memo(function MultiVinAssistCard({
  items,
}: {
  items: VinAssistItem[]
}) {
  const { isDesktop } = useScreenWidth()
  const decodeAllVinAssistForMessage = useChatStore((state) => state.decodeAllVinAssistForMessage)
  const confirmAllDecodedVinAssistForMessage = useChatStore(
    (state) => state.confirmAllDecodedVinAssistForMessage
  )
  const sourceMessageId = items[0]?.sourceMessageId ?? ''
  const fadeIn = useFadeIn(220, 32)
  const [bulkConfirming, setBulkConfirming] = useState(false)
  const total = items.length
  const resolved = items.filter((item) => isRowComplete(item.status)).length
  const decodingAny = items.some((item) => item.status === 'decoding')
  const needsDecode = items.some((item) => item.status === 'detected' || item.status === 'failed')
  const allDone = resolved === total && total > 0
  const progressRatio = total > 0 ? resolved / total : 0
  const decodedAwaitingConfirm = items.filter(
    (item) => item.status === 'decoded' && Boolean(item.vehicleId)
  )
  const showBulkConfirm = decodedAwaitingConfirm.length >= 2
  const bulkConfirmLabel =
    decodedAwaitingConfirm.length === 2 && total === 2
      ? 'Confirm both vehicles'
      : `Confirm ${decodedAwaitingConfirm.length} vehicles`

  return (
    <Animated.View style={{ opacity: fadeIn, alignSelf: 'stretch' }}>
      <XStack paddingHorizontal="$3" paddingBottom="$3" justifyContent="center" width="100%">
        <AppCard
          accent
          compact
          gap="$2"
          flexShrink={0}
          width="100%"
          maxWidth={CHAT_BUBBLE_MAX_WIDTH}
        >
          <YStack gap="$1.5" flexShrink={0}>
            <CardTitle
              right={
                <Text fontSize={11} fontWeight="700" color="$placeholderColor" letterSpacing={0.3}>
                  {resolved}/{total}
                </Text>
              }
            >
              VIN assist
            </CardTitle>
            <Text fontSize={13} color="$placeholderColor" lineHeight={19}>
              {allDone
                ? 'Your message is saved. Getting a reply…'
                : total === 2
                  ? 'Two VINs detected — decode each to send your message.'
                  : `${total} VINs detected — decode each to send your message.`}
            </Text>
          </YStack>

          <YStack gap="$1" flexShrink={0}>
            <XStack
              height={4}
              borderRadius={100}
              backgroundColor="$backgroundHover"
              overflow="hidden"
              width="100%"
            >
              <XStack
                height={4}
                borderRadius={100}
                backgroundColor="$brand"
                width={
                  progressRatio <= 0 ? '0%' : `${Math.max(4, Math.round(progressRatio * 100))}%`
                }
              />
            </XStack>
            {!allDone ? (
              <Text fontSize={11} color="$placeholderColor">
                {resolved === total ? 'All set' : `${total - resolved} remaining`}
              </Text>
            ) : null}
          </YStack>

          <YStack gap="$0" flexShrink={0}>
            {items.map((item, index) => (
              <VinAssistSection
                key={item.id}
                item={item}
                index={index}
                total={total}
                isFirst={index === 0}
                buttonsInline={isDesktop}
                hideDecodedConfirm={showBulkConfirm}
                bulkConfirmInProgress={bulkConfirming}
              />
            ))}
          </YStack>

          {showBulkConfirm ? (
            <YStack
              gap="$1.5"
              paddingTop="$2.5"
              marginTop="$1.5"
              borderTopWidth={1}
              borderTopColor="$borderColor"
              flexShrink={0}
            >
              <AppButton
                minHeight={44}
                width="100%"
                disabled={bulkConfirming || !sourceMessageId}
                onPress={() => {
                  void (async () => {
                    setBulkConfirming(true)
                    try {
                      await confirmAllDecodedVinAssistForMessage(sourceMessageId)
                    } finally {
                      setBulkConfirming(false)
                    }
                  })()
                }}
                accessibilityLabel={bulkConfirmLabel}
              >
                {bulkConfirming ? (
                  <XStack alignItems="center" gap="$2">
                    <Spinner size="small" color="$white" />
                    <Text color="$white" fontSize={14} fontWeight="600">
                      Confirming…
                    </Text>
                  </XStack>
                ) : (
                  bulkConfirmLabel
                )}
              </AppButton>
            </YStack>
          ) : null}

          {needsDecode ? (
            <YStack
              gap="$1.5"
              paddingTop="$2.5"
              marginTop="$1.5"
              borderTopWidth={1}
              borderTopColor="$borderColor"
              flexShrink={0}
            >
              <AppButton
                minHeight={44}
                variant="secondary"
                width="100%"
                disabled={decodingAny || !sourceMessageId}
                icon={decodingAny ? undefined : ScanLine}
                onPress={() => void decodeAllVinAssistForMessage(sourceMessageId)}
                accessibilityLabel="Decode all pending VINs"
              >
                {decodingAny ? 'Decoding…' : 'Decode all'}
              </AppButton>
            </YStack>
          ) : null}
        </AppCard>
      </XStack>
    </Animated.View>
  )
})
