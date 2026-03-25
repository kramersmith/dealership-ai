import { Modal, TouchableOpacity } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { palette } from '@/lib/theme/tokens'
import { AppButton } from './AppButton'

interface ConfirmModalProps {
  visible: boolean
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <TouchableOpacity
        style={{
          flex: 1,
          backgroundColor: palette.overlay,
          justifyContent: 'center',
          alignItems: 'center',
        }}
        activeOpacity={1}
        onPress={onCancel}
      >
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <YStack
            backgroundColor="$backgroundStrong"
            borderRadius="$4"
            padding="$5"
            width={320}
            gap="$4"
            borderWidth={1}
            borderColor="$borderColor"
          >
            <YStack gap="$2">
              <Text fontSize={18} fontWeight="700" color="$color">
                {title}
              </Text>
              <Text fontSize={14} color="$placeholderColor" lineHeight={20}>
                {message}
              </Text>
            </YStack>

            <XStack gap="$3" justifyContent="flex-end">
              <AppButton variant="ghost" onPress={onCancel} minWidth={80}>
                Cancel
              </AppButton>
              <AppButton variant="danger" onPress={onConfirm} minWidth={80}>
                {confirmLabel}
              </AppButton>
            </XStack>
          </YStack>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}
