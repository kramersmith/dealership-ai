import { useEffect, useRef, useState } from 'react'
import { FlatList, TouchableOpacity, Animated } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import {
  ThemedSafeArea,
  AppCard,
  HamburgerMenu,
  LoadingIndicator,
  RoleGuard,
  ConfirmModal,
} from '@/components/shared'
import { useRouter } from 'expo-router'
import { MessageSquare, Plus, Trash2 } from '@tamagui/lucide-icons'
import type { Session } from '@/lib/types'
import { useChatStore } from '@/stores/chatStore'
import { colors } from '@/lib/colors'
import { useFadeIn, useSlideIn } from '@/hooks/useAnimatedValue'

const MS_PER_HOUR = 1000 * 60 * 60
const MS_PER_DAY = MS_PER_HOUR * 24
const HOURS_PER_DAY = 24
const DAYS_PER_WEEK = 7

function formatDate(dateStr: string) {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffHours = Math.floor(diffMs / MS_PER_HOUR)
  const diffDays = Math.floor(diffMs / MS_PER_DAY)
  if (diffHours < 1) return 'Just now'
  if (diffHours < HOURS_PER_DAY) return `${diffHours}h ago`
  if (diffDays < DAYS_PER_WEEK) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function SessionCard({
  item,
  index,
  onSelect,
  onDelete,
}: {
  item: Session
  index: number
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}) {
  const { opacity, translateY } = useSlideIn(250, index * 60)

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <TouchableOpacity onPress={() => onSelect(item.id)} activeOpacity={0.7}>
        <AppCard>
          <XStack justifyContent="space-between" alignItems="flex-start">
            <YStack flex={1} gap="$1">
              <Text fontSize={16} fontWeight="600" color="$color" numberOfLines={1}>
                {item.title}
              </Text>
              {item.lastMessagePreview ? (
                <Text fontSize={13} color="$placeholderColor" numberOfLines={2}>
                  {item.lastMessagePreview}
                </Text>
              ) : null}
              <Text fontSize={11} color="$placeholderColor">
                {formatDate(item.updatedAt)}
              </Text>
            </YStack>
            <TouchableOpacity
              onPress={() => onDelete(item.id)}
              activeOpacity={0.6}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <Trash2 size={18} color="$placeholderColor" />
            </TouchableOpacity>
          </XStack>
        </AppCard>
      </TouchableOpacity>
    </Animated.View>
  )
}

function EmptySessionsState() {
  const opacity = useFadeIn(500)
  return (
    <Animated.View style={{ flex: 1, opacity }}>
      <YStack flex={1} justifyContent="center" alignItems="center" padding="$6" gap="$3">
        <MessageSquare size={48} color="$borderColor" />
        <Text fontSize={16} fontWeight="600" color="$color">
          No sessions yet
        </Text>
        <Text fontSize={14} color="$placeholderColor" textAlign="center">
          Start a new deal to get going.
        </Text>
      </YStack>
    </Animated.View>
  )
}

export default function SessionsScreen() {
  const router = useRouter()
  const { sessions, isLoading, loadSessions, setActiveSession, createSession, deleteSession } =
    useChatStore()

  useEffect(() => {
    loadSessions()
  }, [])

  const handleSelect = async (sessionId: string) => {
    try {
      await setActiveSession(sessionId)
      router.push('/(app)/chat')
    } catch {
      // Error already logged in chatStore
    }
  }

  const isCreating = useRef(false)

  const handleNew = async () => {
    if (isCreating.current) return
    isCreating.current = true
    try {
      await createSession('buyer_chat', 'New Deal')
      router.push('/(app)/chat')
    } catch {
      // Error already logged in chatStore
    } finally {
      isCreating.current = false
    }
  }

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const handleDelete = (sessionId: string) => {
    setDeleteTarget(sessionId)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleteTarget(null)
    try {
      await deleteSession(deleteTarget)
    } catch {
      // Error already logged in chatStore
    }
  }

  return (
    <RoleGuard role="buyer">
      <ThemedSafeArea edges={['top']}>
        <YStack flex={1} backgroundColor="$background">
          {/* Header */}
          <XStack
            paddingHorizontal="$4"
            paddingVertical="$3"
            alignItems="center"
            justifyContent="space-between"
            borderBottomWidth={1}
            borderBottomColor="$borderColor"
            backgroundColor="$backgroundStrong"
          >
            <HamburgerMenu />
            <Text fontSize={18} fontWeight="700" color="$color">
              Sessions
            </Text>
            <TouchableOpacity
              onPress={handleNew}
              activeOpacity={0.6}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <Plus size={22} color={colors.brand} />
            </TouchableOpacity>
          </XStack>

          {isLoading ? (
            <LoadingIndicator message="Loading sessions..." />
          ) : sessions.length === 0 ? (
            <EmptySessionsState />
          ) : (
            <FlatList
              data={sessions}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{
                padding: 16,
                maxWidth: 480,
                width: '100%',
                alignSelf: 'center',
              }}
              ItemSeparatorComponent={() => <YStack height={12} />}
              renderItem={({ item, index }) => (
                <SessionCard
                  item={item}
                  index={index}
                  onSelect={handleSelect}
                  onDelete={handleDelete}
                />
              )}
            />
          )}
        </YStack>
      </ThemedSafeArea>

      <ConfirmModal
        visible={deleteTarget !== null}
        title="Delete Session"
        message="Are you sure you want to delete this session? This cannot be undone."
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </RoleGuard>
  )
}
