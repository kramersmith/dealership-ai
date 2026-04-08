import { memo, useState, useCallback } from 'react'
import { YStack, XStack, Text, Spinner } from 'tamagui'

import type { VinAssistItem } from '@/lib/types'
import { CHAT_BUBBLE_MAX_WIDTH } from '@/lib/constants'
import { AppButton, AppCard } from '@/components/shared'
import { useScreenWidth } from '@/hooks/useScreenWidth'
import { useChatStore } from '@/stores/chatStore'
import { vinAssistVehicleLabel as vehicleLabel } from './vinAssistUtils'

export const VinAssistCard = memo(function VinAssistCard({ item }: { item: VinAssistItem }) {
  const { isDesktop } = useScreenWidth()
  const skipVinAssist = useChatStore((s) => s.skipVinAssist)
  const decodeVinAssist = useChatStore((s) => s.decodeVinAssist)
  const confirmVinAssist = useChatStore((s) => s.confirmVinAssist)
  const rejectVinAssist = useChatStore((s) => s.rejectVinAssist)

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

  const btnFlex = isDesktop
    ? ({ flex: 1, minWidth: 0 } as const)
    : ({ width: '100%' as const } as const)

  return (
    <XStack paddingHorizontal="$3" paddingBottom="$3" justifyContent="center" width="100%">
      <AppCard accent width="100%" maxWidth={CHAT_BUBBLE_MAX_WIDTH}>
        <YStack gap="$3">
          <YStack gap="$1">
            <Text fontSize={12} fontWeight="700" color="$placeholderColor" letterSpacing={0.4}>
              VIN Assist
            </Text>
            <Text fontSize={15} fontWeight="700" color="$color">
              {item.status === 'decoded' || item.status === 'confirmed'
                ? vehicleLabel(item)
                : 'VIN detected'}
            </Text>
            <Text fontSize={13} color="$placeholderColor" lineHeight={19}>
              {item.status === 'decoded'
                ? 'We decoded this VIN. Confirm it before we use the vehicle identity in future advice.'
                : item.status === 'confirmed'
                  ? 'Confirmed vehicle details will now ground future chat responses.'
                  : item.status === 'rejected'
                    ? 'We will keep treating this as a raw VIN unless you retry the decode.'
                    : item.status === 'failed'
                      ? (item.error ??
                        'Decode failed. You can retry or keep going without decoding.')
                      : item.status === 'skipped'
                        ? 'You can keep chatting now and come back to decode this VIN any time.'
                        : 'We found a VIN in your message. Decode it now so the AI can give you vehicle-specific advice from the start.'}
            </Text>
          </YStack>

          <YStack gap="$1">
            <Text fontSize={12} color="$placeholderColor">
              VIN
            </Text>
            <Text fontSize={14} fontWeight="600" color="$color">
              {item.vin}
            </Text>
          </YStack>

          {item.decodedVehicle ? (
            <YStack gap="$1">
              <Text fontSize={12} color="$placeholderColor">
                Decoded vehicle
              </Text>
              <Text fontSize={14} fontWeight="600" color="$color">
                {vehicleLabel(item)}
              </Text>
              {item.decodedVehicle.partial ? (
                <Text fontSize={12} color="$placeholderColor">
                  Some details may be incomplete.
                </Text>
              ) : null}
            </YStack>
          ) : null}

          {item.status === 'decoding' ? (
            <XStack alignItems="center" gap="$2">
              <Spinner size="small" color="$brand" />
              <Text fontSize={13} color="$placeholderColor">
                Decoding VIN...
              </Text>
            </XStack>
          ) : null}

          {item.status === 'detected' ||
          item.status === 'skipped' ||
          item.status === 'failed' ||
          item.status === 'rejected' ? (
            isDesktop && item.status === 'detected' ? (
              <XStack width="100%" gap="$2" alignItems="stretch">
                <AppButton
                  minHeight={44}
                  {...btnFlex}
                  onPress={() => decodeVinAssist(item.id)}
                  accessibilityLabel={`Decode VIN ${item.vin}`}
                >
                  Decode VIN
                </AppButton>
                <AppButton
                  minHeight={44}
                  {...btnFlex}
                  variant="outline"
                  onPress={() => skipVinAssist(item.id)}
                  accessibilityLabel="Continue without decoding"
                >
                  Continue without decoding
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
                    accessibilityLabel="Continue without decoding"
                  >
                    Continue without decoding
                  </AppButton>
                ) : null}
              </YStack>
            )
          ) : null}

          {item.status === 'decoded' ? (
            isDesktop ? (
              <XStack width="100%" gap="$2" alignItems="stretch">
                <AppButton
                  minHeight={44}
                  {...btnFlex}
                  onPress={handleConfirm}
                  disabled={confirming || rejecting}
                  accessibilityLabel="Confirm decoded vehicle"
                >
                  {confirming ? (
                    <XStack alignItems="center" gap="$2">
                      <Spinner size="small" color="$white" />
                      <Text color="$white" fontSize={14} fontWeight="600">
                        Confirming...
                      </Text>
                    </XStack>
                  ) : (
                    'Yes, use this vehicle'
                  )}
                </AppButton>
                <AppButton
                  minHeight={44}
                  {...btnFlex}
                  variant="outline"
                  onPress={handleReject}
                  disabled={confirming || rejecting}
                  accessibilityLabel="Reject decoded vehicle"
                >
                  {rejecting ? (
                    <XStack alignItems="center" gap="$2">
                      <Spinner size="small" color="$placeholderColor" />
                      <Text color="$placeholderColor" fontSize={14}>
                        Rejecting...
                      </Text>
                    </XStack>
                  ) : (
                    "No, that's not correct"
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
                        Confirming...
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
                    <XStack alignItems="center" gap="$2">
                      <Spinner size="small" color="$placeholderColor" />
                      <Text color="$placeholderColor" fontSize={14}>
                        Rejecting...
                      </Text>
                    </XStack>
                  ) : (
                    "No, that's not correct"
                  )}
                </AppButton>
              </YStack>
            )
          ) : null}
        </YStack>
      </AppCard>
    </XStack>
  )
})
