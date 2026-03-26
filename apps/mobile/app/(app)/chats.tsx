import { useCallback, useEffect, useRef, useState } from 'react'
import { SectionList, RefreshControl, TouchableOpacity, Animated, Platform } from 'react-native'
import { YStack, XStack, Text, Input } from 'tamagui'
import {
  ThemedSafeArea,
  LoadingIndicator,
  RoleGuard,
  ConfirmModal,
  AppButton,
} from '@/components/shared'
import { useRouter } from 'expo-router'
import { Plus, Search, Settings } from '@tamagui/lucide-icons'
import type { BuyerContext, Session } from '@/lib/types'
import { APP_NAME } from '@/lib/constants'
import { useChatStore } from '@/stores/chatStore'
import { useFadeIn, useIconEntrance } from '@/hooks/useAnimatedValue'
import { SessionCard } from '@/components/chats'
import { WelcomePrompts } from '@/components/chat'

// ─── Section builder: active deals above, past deals below ───

function buildSections(sessions: Session[]) {
  const active: Session[] = []
  const past: Session[] = []

  for (const session of sessions) {
    const phase = session.dealSummary?.phase
    if (phase === 'closing') {
      past.push(session)
    } else {
      active.push(session)
    }
  }

  const sections: { title: string; data: Session[] }[] = []
  if (active.length > 0) sections.push({ title: 'Active', data: active })
  if (past.length > 0) sections.push({ title: 'Past', data: past })
  return sections
}

// ─── Empty state with embedded WelcomePrompts ───

function EmptySessionsState({ onContextSelect }: { onContextSelect: (ctx: BuyerContext) => void }) {
  const opacity = useFadeIn(500)
  return (
    <Animated.View style={{ flex: 1, opacity }}>
      <WelcomePrompts onSelect={onContextSelect} />
    </Animated.View>
  )
}

// ─── Empty search results ───

function EmptySearchState({ query }: { query: string }) {
  const opacity = useFadeIn(300)
  return (
    <Animated.View style={{ flex: 1, opacity }}>
      <YStack flex={1} justifyContent="center" alignItems="center" padding="$6" gap="$2">
        <Text fontSize={15} color="$placeholderColor" textAlign="center">
          No chats matching &ldquo;{query}&rdquo;
        </Text>
      </YStack>
    </Animated.View>
  )
}

// ─── Error state ───

function ErrorState({ onRetry }: { onRetry: () => void }) {
  const opacity = useFadeIn(300)
  return (
    <Animated.View style={{ flex: 1, opacity }}>
      <YStack flex={1} justifyContent="center" alignItems="center" padding="$6" gap="$4">
        <Text fontSize={15} color="$placeholderColor" textAlign="center">
          Couldn&apos;t load your chats
        </Text>
        <AppButton variant="secondary" onPress={onRetry}>
          Try Again
        </AppButton>
      </YStack>
    </Animated.View>
  )
}

// ─── Main screen ───

export default function SessionsScreen() {
  const router = useRouter()
  const settingsIcon = useIconEntrance()
  const sessions = useChatStore((state) => state.sessions)
  const isLoading = useChatStore((state) => state.isLoading)
  const loadSessions = useChatStore((state) => state.loadSessions)
  const setActiveSession = useChatStore((state) => state.setActiveSession)
  const createSession = useChatStore((state) => state.createSession)
  const deleteSession = useChatStore((state) => state.deleteSession)
  const searchSessions = useChatStore((state) => state.searchSessions)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Session[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const isCreating = useRef(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadSessionsWithError = useCallback(async () => {
    setLoadError(false)
    try {
      await loadSessions()
    } catch {
      setLoadError(true)
    }
  }, [loadSessions])

  // Initial load
  const hasAutoNavigated = useRef(false)
  useEffect(() => {
    loadSessionsWithError()
  }, [loadSessionsWithError])

  // Single-session fast-path: auto-navigate to chat if exactly 1 session.
  // Only fires once after the initial load to avoid surprising re-redirects
  // (e.g. after deleting sessions down to 1).
  useEffect(() => {
    if (hasAutoNavigated.current) return
    if (!isLoading && sessions.length === 1 && !searchQuery) {
      hasAutoNavigated.current = true
      setActiveSession(sessions[0].id).then(() => {
        router.replace('/(app)/chat')
      })
    }
  }, [isLoading, sessions, searchQuery, setActiveSession, router])

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [])

  // Debounced search
  const handleSearchChange = useCallback(
    (text: string) => {
      setSearchQuery(text)
      if (searchTimer.current) clearTimeout(searchTimer.current)

      if (!text.trim()) {
        setSearchResults(null)
        setIsSearching(false)
        return
      }

      setIsSearching(true)
      setSearchError(false)
      searchTimer.current = setTimeout(async () => {
        try {
          const results = await searchSessions(text.trim())
          setSearchResults(results)
        } catch {
          setSearchError(true)
          setSearchResults(null)
        } finally {
          setIsSearching(false)
        }
      }, 300)
    },
    [searchSessions]
  )

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await loadSessions()
    } catch {
      // Pull-to-refresh failure is non-critical; the existing list stays visible.
    } finally {
      setIsRefreshing(false)
    }
  }, [loadSessions])

  const handleSelect = async (sessionId: string) => {
    try {
      await setActiveSession(sessionId)
      router.push('/(app)/chat')
    } catch {
      // Error already logged in chatStore
    }
  }

  const handleNew = async () => {
    if (isCreating.current) return
    isCreating.current = true
    try {
      await createSession('buyer_chat')
      router.push('/(app)/chat')
    } catch {
      // Error already logged
    } finally {
      isCreating.current = false
    }
  }

  const handleContextSelect = async (context: BuyerContext) => {
    if (isCreating.current) return
    isCreating.current = true
    try {
      await createSession('buyer_chat', undefined, context)
      router.push('/(app)/chat')
    } catch {
      // Error already logged
    } finally {
      isCreating.current = false
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleteTarget(null)
    try {
      await deleteSession(deleteTarget)
    } catch {
      // Error already logged
    }
  }

  const displaySessions = searchResults ?? sessions
  const sections = buildSections(displaySessions)
  const showEmptyState = !isLoading && !loadError && sessions.length === 0 && !searchQuery
  const showEmptySearch =
    searchQuery.trim() && !isSearching && !searchError && displaySessions.length === 0
  const showSearchError = searchQuery.trim() && !isSearching && searchError

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
            <TouchableOpacity
              onPress={() => router.push('/(app)/settings')}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel="Settings"
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <Animated.View
                style={{
                  opacity: settingsIcon.opacity,
                  transform: [{ rotate: settingsIcon.rotate }],
                }}
              >
                <Settings size={22} color="$color" />
              </Animated.View>
            </TouchableOpacity>
            <Text fontSize={18} fontWeight="700" color="$color">
              {APP_NAME}
            </Text>
            <TouchableOpacity
              onPress={handleNew}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel="Start new chat"
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <Plus size={22} color="$brand" />
            </TouchableOpacity>
          </XStack>

          {/* Search bar (only show when there are sessions) */}
          {sessions.length > 0 && (
            <XStack
              paddingHorizontal="$4"
              paddingVertical="$2"
              backgroundColor="$backgroundStrong"
              borderBottomWidth={1}
              borderBottomColor="$borderColor"
            >
              <XStack
                flex={1}
                alignItems="center"
                gap="$2"
                backgroundColor="$backgroundHover"
                borderRadius="$3"
                paddingHorizontal="$3"
                minHeight={44}
              >
                <Search size={16} color="$placeholderColor" />
                <Input
                  flex={1}
                  size="$3"
                  placeholder="Search chats..."
                  value={searchQuery}
                  onChangeText={handleSearchChange}
                  backgroundColor="transparent"
                  borderWidth={0}
                  {...(Platform.OS === 'web' ? { style: { outlineWidth: 0 } } : {})}
                />
              </XStack>
            </XStack>
          )}

          {/* Content */}
          {isLoading && sessions.length === 0 ? (
            <LoadingIndicator message="Loading your chats..." />
          ) : loadError ? (
            <ErrorState onRetry={loadSessionsWithError} />
          ) : showEmptyState ? (
            <EmptySessionsState onContextSelect={handleContextSelect} />
          ) : showSearchError ? (
            <ErrorState onRetry={() => handleSearchChange(searchQuery)} />
          ) : showEmptySearch ? (
            <EmptySearchState query={searchQuery} />
          ) : (
            <SectionList
              sections={sections}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{
                padding: 16,
                maxWidth: 480,
                width: '100%',
                alignSelf: 'center',
              }}
              ItemSeparatorComponent={() => <YStack height={12} />}
              renderSectionHeader={({ section }) =>
                sections.length > 1 ? (
                  <Text
                    fontSize={12}
                    fontWeight="600"
                    color="$placeholderColor"
                    textTransform="uppercase"
                    letterSpacing={0.5}
                    marginBottom="$2"
                    marginTop="$3"
                  >
                    {section.title}
                  </Text>
                ) : null
              }
              renderItem={({ item, index }) => (
                <SessionCard
                  session={item}
                  index={index}
                  onSelect={handleSelect}
                  onDelete={setDeleteTarget}
                />
              )}
              refreshControl={
                <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
              }
              stickySectionHeadersEnabled={false}
            />
          )}
        </YStack>
      </ThemedSafeArea>

      <ConfirmModal
        visible={deleteTarget !== null}
        title="Delete Chat"
        message="Are you sure you want to delete this chat? All messages and data will be permanently removed."
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </RoleGuard>
  )
}
