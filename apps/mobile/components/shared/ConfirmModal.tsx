import { useRef, useEffect } from 'react'
import { Modal, TouchableOpacity, Animated } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { palette } from '@/lib/theme/tokens'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
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
  const scale = useRef(new Animated.Value(0.9)).current
  const contentOpacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (visible) {
      scale.setValue(0.9)
      contentOpacity.setValue(0)
      Animated.parallel([
        Animated.timing(scale, {
          toValue: 1,
          duration: 200,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]).start()
    }
  }, [visible, scale, contentOpacity])

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
          <Animated.View style={{ transform: [{ scale }], opacity: contentOpacity }}>
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
          </Animated.View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}
