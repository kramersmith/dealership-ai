import { memo } from 'react'
import { YStack, XStack, Text, Spinner } from 'tamagui'

import type { VinAssistItem } from '@/lib/types'
import { AppButton, AppCard } from '@/components/shared'
import { useChatStore } from '@/stores/chatStore'

function vehicleLabel(item: VinAssistItem): string {
  const decoded = item.decodedVehicle
  if (!decoded) return item.vin
  return [decoded.year, decoded.make, decoded.model, decoded.trim].filter(Boolean).join(' ')
}

export const VinAssistCard = memo(function VinAssistCard({ item }: { item: VinAssistItem }) {
  const skipVinAssist = useChatStore((s) => s.skipVinAssist)
  const decodeVinAssist = useChatStore((s) => s.decodeVinAssist)
  const confirmVinAssist = useChatStore((s) => s.confirmVinAssist)
  const rejectVinAssist = useChatStore((s) => s.rejectVinAssist)

  return (
    <XStack paddingHorizontal="$3" paddingBottom="$3" justifyContent="flex-start">
      <AppCard accent style={{ width: '92%' } as any}>
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
            <XStack gap="$2" flexWrap="wrap">
              <AppButton minHeight={44} onPress={() => decodeVinAssist(item.id)}>
                Decode VIN
              </AppButton>
              {item.status === 'detected' ? (
                <AppButton minHeight={44} variant="ghost" onPress={() => skipVinAssist(item.id)}>
                  Continue without decoding
                </AppButton>
              ) : null}
            </XStack>
          ) : null}

          {item.status === 'decoded' ? (
            <XStack gap="$2" flexWrap="wrap">
              <AppButton minHeight={44} onPress={() => confirmVinAssist(item.id)}>
                Yes, use this vehicle
              </AppButton>
              <AppButton minHeight={44} variant="ghost" onPress={() => rejectVinAssist(item.id)}>
                No, that&apos;s not correct
              </AppButton>
            </XStack>
          ) : null}
        </YStack>
      </AppCard>
    </XStack>
  )
})
