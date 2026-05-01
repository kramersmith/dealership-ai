import { memo, useState, useCallback } from 'react'
import { View } from 'react-native'
import { YStack, XStack, Text, Spinner } from 'tamagui'

import type { VinAssistItem } from '@/lib/types'
import { CHAT_BUBBLE_MAX_WIDTH, DISPLAY_FONT_FAMILY, MONO_FONT_FAMILY } from '@/lib/constants'
import { AppCard, ModalGhostButton, ModalPrimaryButton } from '@/components/shared'
import { palette } from '@/lib/theme/tokens'
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

  const showActions =
    item.status === 'detected' ||
    item.status === 'skipped' ||
    item.status === 'failed' ||
    item.status === 'rejected' ||
    item.status === 'decoded'

  const ActionRow = isDesktop ? XStack : YStack
  const actionRowProps = isDesktop
    ? { width: '100%', gap: 8, alignItems: 'stretch' as const, justifyContent: 'flex-end' as const }
    : { gap: 8, width: '100%', alignItems: 'stretch' as const }
  const actionFlex = isDesktop ? 1 : undefined

  const headlineText =
    item.status === 'decoded' || item.status === 'confirmed' ? vehicleLabel(item) : 'VIN detected'

  const subText =
    item.status === 'decoded'
      ? 'We decoded this VIN. Confirm it before we use the vehicle identity in future advice.'
      : item.status === 'confirmed'
        ? 'Confirmed vehicle details will now ground future chat responses.'
        : item.status === 'rejected'
          ? 'We will keep treating this as a raw VIN unless you retry the decode.'
          : item.status === 'failed'
            ? (item.error ?? 'Decode failed. You can retry or keep going without decoding.')
            : item.status === 'skipped'
              ? 'You can keep chatting now and come back to decode this VIN any time.'
              : 'We found a VIN in your message. Decode it now so the AI can give you vehicle-specific advice from the start.'

  return (
    <XStack paddingHorizontal="$3" paddingBottom="$3" justifyContent="center" width="100%">
      <AppCard
        width="100%"
        maxWidth={CHAT_BUBBLE_MAX_WIDTH}
        backgroundColor="rgba(30, 41, 59, 0.80)"
      >
        <YStack gap={16}>
          <YStack gap={6}>
            <Text
              fontSize={11}
              fontWeight="600"
              color={palette.copilotEmerald}
              letterSpacing={1}
              textTransform="uppercase"
            >
              VIN Assist
            </Text>
            <Text
              fontSize={18}
              fontWeight="600"
              color={palette.slate50}
              letterSpacing={-0.2}
              fontFamily={DISPLAY_FONT_FAMILY}
            >
              {headlineText}
            </Text>
            <Text fontSize={13} color={palette.slate400} lineHeight={19}>
              {subText}
            </Text>
          </YStack>

          <View
            style={{
              borderRadius: 10,
              borderWidth: 1,
              borderColor: palette.ghostBgHover,
              backgroundColor: 'rgba(2, 6, 23, 0.65)',
              paddingHorizontal: 12,
              paddingVertical: 10,
              gap: 4,
            }}
          >
            <Text
              fontSize={11}
              color={palette.slate500}
              letterSpacing={0.6}
              textTransform="uppercase"
            >
              VIN
            </Text>
            <Text
              fontSize={14}
              fontWeight="400"
              color={palette.slate50}
              fontFamily={MONO_FONT_FAMILY}
              letterSpacing={0.4}
            >
              {item.vin}
            </Text>
          </View>

          {item.decodedVehicle ? (
            <View
              style={{
                borderRadius: 10,
                borderWidth: 1,
                borderColor: palette.copilotEmeraldBorder25,
                backgroundColor: palette.copilotEmeraldMuted,
                paddingHorizontal: 12,
                paddingVertical: 10,
                gap: 4,
              }}
            >
              <Text
                fontSize={11}
                color={palette.copilotEmerald}
                letterSpacing={0.6}
                textTransform="uppercase"
              >
                Decoded vehicle
              </Text>
              <Text fontSize={14} fontWeight="700" color={palette.slate50}>
                {vehicleLabel(item)}
              </Text>
              {item.decodedVehicle.partial ? (
                <Text fontSize={12} color={palette.slate400}>
                  Some details may be incomplete.
                </Text>
              ) : null}
            </View>
          ) : null}

          {item.status === 'decoding' ? (
            <XStack alignItems="center" gap="$2">
              <Spinner size="small" color={palette.copilotEmerald} />
              <Text fontSize={13} color={palette.slate400}>
                Decoding VIN...
              </Text>
            </XStack>
          ) : null}

          {showActions && item.status !== 'decoded' ? (
            <ActionRow {...actionRowProps}>
              {item.status === 'detected' ? (
                <ModalGhostButton flex={actionFlex} onPress={() => skipVinAssist(item.id)}>
                  Skip
                </ModalGhostButton>
              ) : null}
              <ModalPrimaryButton flex={actionFlex} onPress={() => decodeVinAssist(item.id)}>
                {item.status === 'failed' || item.status === 'rejected'
                  ? 'Retry decode'
                  : 'Decode VIN'}
              </ModalPrimaryButton>
            </ActionRow>
          ) : null}

          {item.status === 'decoded' ? (
            <ActionRow {...actionRowProps}>
              <ModalGhostButton
                flex={actionFlex}
                onPress={handleReject}
                disabled={confirming || rejecting}
              >
                {rejecting ? 'Rejecting…' : 'No, that’s not it'}
              </ModalGhostButton>
              <ModalPrimaryButton
                flex={actionFlex}
                onPress={handleConfirm}
                disabled={confirming || rejecting}
              >
                {confirming ? 'Confirming…' : 'Yes, use this'}
              </ModalPrimaryButton>
            </ActionRow>
          ) : null}
        </YStack>
      </AppCard>
    </XStack>
  )
})
