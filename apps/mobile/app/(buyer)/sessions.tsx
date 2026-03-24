import { useEffect } from 'react'
import { FlatList, TouchableOpacity } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { ThemedSafeArea } from '@/components/shared'
import { useRouter } from 'expo-router'
import { MessageSquare, Plus, Trash2 } from '@tamagui/lucide-icons'
import { useChatStore } from '@/stores/chatStore'
import { colors } from '@/lib/colors'
import { AppCard, HamburgerMenu, LoadingIndicator } from '@/components/shared'

export default function SessionsScreen() {
  const router = useRouter()
  const { sessions, isLoading, loadSessions, setActiveSession, createSession, deleteSession } = useChatStore()

  useEffect(() => {
    loadSessions()
  }, [])

  const handleSelect = async (sessionId: string) => {
    await setActiveSession(sessionId)
    router.push('/(buyer)/chat')
  }

  const handleNew = async () => {
    await createSession('buyer_chat', 'New Deal')
    router.push('/(buyer)/chat')
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffHours < 1) return 'Just now'
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  return (
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
          <YStack flex={1} justifyContent="center" alignItems="center" padding="$6" gap="$3">
            <MessageSquare size={48} color="$borderColor" />
            <Text fontSize={16} fontWeight="600" color="$color">No sessions yet</Text>
            <Text fontSize={14} color="$placeholderColor" textAlign="center">
              Start a new deal to get going.
            </Text>
          </YStack>
        ) : (
          <FlatList
            data={sessions}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 16 }}
            ItemSeparatorComponent={() => <YStack height={12} />}
            renderItem={({ item }) => (
              <TouchableOpacity onPress={() => handleSelect(item.id)} activeOpacity={0.7}>
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
                      onPress={() => deleteSession(item.id)}
                      activeOpacity={0.6}
                      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Trash2 size={18} color="$placeholderColor" />
                    </TouchableOpacity>
                  </XStack>
                </AppCard>
              </TouchableOpacity>
            )}
          />
        )}
      </YStack>
    </ThemedSafeArea>
  )
}
