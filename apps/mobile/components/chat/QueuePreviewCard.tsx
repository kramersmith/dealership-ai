import { useEffect, useRef } from 'react'
import { Animated, Platform } from 'react-native'
import { YStack, Text } from 'tamagui'
import { CHAT_SCREEN_LAYOUT } from '@/lib/chatLayout'
import { USE_NATIVE_DRIVER } from '@/lib/platform'

const QUEUE_PREVIEW_EXIT_MS = 220

interface QueuePreviewCardProps {
  content: string
  exiting: boolean
  prefersReducedMotion: boolean
}

export function QueuePreviewCard({
  content,
  exiting,
  prefersReducedMotion,
}: QueuePreviewCardProps) {
  const opacity = useRef(new Animated.Value(prefersReducedMotion ? 1 : 0)).current
  const translateY = useRef(new Animated.Value(prefersReducedMotion ? 0 : 8)).current
  const scale = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (prefersReducedMotion) {
      opacity.setValue(exiting ? 0 : 1)
      translateY.setValue(0)
      scale.setValue(1)
      return
    }
    if (exiting) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: QUEUE_PREVIEW_EXIT_MS,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(translateY, {
          toValue: -8,
          duration: QUEUE_PREVIEW_EXIT_MS,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(scale, {
          toValue: 0.98,
          duration: QUEUE_PREVIEW_EXIT_MS,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]).start()
      return
    }
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 180,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 180,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start()
  }, [exiting, opacity, prefersReducedMotion, scale, translateY])

  return (
    <Animated.View
      style={{
        opacity,
        transform: [{ translateY }, { scale }],
        width: Platform.OS === 'web' ? CHAT_SCREEN_LAYOUT.webQueuePreviewCardWidthPx : undefined,
        alignSelf: 'flex-end',
      }}
    >
      <YStack
        maxWidth={Platform.OS === 'web' ? undefined : '78%'}
        width={Platform.OS === 'web' ? '100%' : undefined}
        backgroundColor="$backgroundHover"
        borderWidth={1}
        borderColor="$borderColor"
        borderRadius="$4"
        paddingHorizontal="$3"
        paddingVertical="$2"
      >
        <Text fontSize={11} color="$placeholderColor" lineHeight={16}>
          Queued
        </Text>
        <Text fontSize={13} lineHeight={19} color="$color" numberOfLines={2}>
          {content}
        </Text>
      </YStack>
    </Animated.View>
  )
}
