import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SectionList,
  RefreshControl,
  Animated,
  Platform,
  TouchableOpacity,
  View,
  Text as RNText,
  TextInput,
} from 'react-native'
import { useTheme, useThemeName } from 'tamagui'
import {
  ThemedSafeArea,
  LoadingIndicator,
  RoleGuard,
  ConfirmModal,
  AppButton,
  ScreenHeader,
} from '@/components/shared'
import { useRouter } from 'expo-router'
import { MessageSquarePlus, Search, Settings, X } from '@tamagui/lucide-icons'
import { useIsFocused } from '@react-navigation/native'
import type { Session } from '@/lib/types'
import { APP_NAME } from '@/lib/constants'
import { useChatStore } from '@/stores/chatStore'
import { useFocusEffect } from 'expo-router'
import { useFadeIn } from '@/hooks/useAnimatedValue'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { SessionCard } from '@/components/chats'
import { palette } from '@/lib/theme/tokens'

/** Target width for search + cards (inside horizontal insets). */
const CHATS_CONTENT_MAX_WIDTH = 480
/**
 * Same horizontal inset on the search row and on SectionList rows so the column aligns while scrolling.
 * ScrollViews clip to their bounds — shadows must draw inside this inset, not only on outer wrappers.
 */
const CHATS_EDGE_INSET = 24
const CHATS_SHEET_MAX_WIDTH = CHATS_CONTENT_MAX_WIDTH + 2 * CHATS_EDGE_INSET
/** Space below the search (list header) before section labels / first card. */
const CHATS_LIST_BELOW_SEARCH_GAP = 12

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

// ─── Empty state ───

function EmptySessionsState({ onNewChat }: { onNewChat: () => void }) {
  const opacity = useFadeIn(500)
  const theme = useTheme()
  const colorVal = (theme.color?.val as string | undefined) ?? '#1C1E21'
  const placeholderVal = (theme.placeholderColor?.val as string | undefined) ?? palette.overlay
  return (
    <Animated.View style={{ flex: 1, opacity }}>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
          gap: 12,
        }}
      >
        <RNText style={{ fontSize: 18, fontWeight: '700', color: colorVal, textAlign: 'center' }}>
          No chats yet
        </RNText>
        <RNText
          style={{
            fontSize: 14,
            color: placeholderVal,
            textAlign: 'center',
            lineHeight: 22,
          }}
        >
          Start a new chat to get help with your car deal.
        </RNText>
        <View style={{ paddingTop: 8 }}>
          <AppButton onPress={onNewChat}>Start a Chat</AppButton>
        </View>
      </View>
    </Animated.View>
  )
}

// ─── Empty search results ───

function EmptySearchState({ query }: { query: string }) {
  const opacity = useFadeIn(300)
  const theme = useTheme()
  const placeholderVal = (theme.placeholderColor?.val as string | undefined) ?? palette.overlay
  return (
    <Animated.View style={{ flex: 1, opacity }}>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
          gap: 8,
        }}
      >
        <RNText style={{ fontSize: 15, color: placeholderVal, textAlign: 'center' }}>
          No chats matching &ldquo;{query}&rdquo;
        </RNText>
      </View>
    </Animated.View>
  )
}

// ─── Error state ───

function ErrorState({ onRetry }: { onRetry: () => void }) {
  const opacity = useFadeIn(300)
  const theme = useTheme()
  const placeholderVal = (theme.placeholderColor?.val as string | undefined) ?? palette.overlay
  return (
    <Animated.View style={{ flex: 1, opacity }}>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
          gap: 16,
        }}
      >
        <RNText style={{ fontSize: 15, color: placeholderVal, textAlign: 'center' }}>
          Couldn&apos;t load your chats
        </RNText>
        <AppButton variant="secondary" onPress={onRetry}>
          Try Again
        </AppButton>
      </View>
    </Animated.View>
  )
}

function SearchBar({
  searchQuery,
  onChangeText,
  isFocused,
}: {
  searchQuery: string
  onChangeText: (text: string) => void
  isFocused: boolean
}) {
  const theme = useTheme()
  const themeName = useThemeName()
  const translateY = useRef(new Animated.Value(-32)).current
  const opacity = useRef(new Animated.Value(0)).current
  const [isInputFocused, setIsInputFocused] = useState(false)
  const hasQuery = searchQuery.trim().length > 0
  const isDarkTheme = typeof themeName === 'string' && themeName.startsWith('dark')
  const shellBackgroundColor = (theme.backgroundStrong?.val as string | undefined) ?? palette.white
  const fieldBackgroundColor = isDarkTheme
    ? palette.whiteTint10
    : ((theme.background?.val as string | undefined) ?? palette.white)
  const iconBackgroundColor = isDarkTheme
    ? 'rgba(255,255,255,0.06)'
    : ((theme.backgroundHover?.val as string | undefined) ?? palette.white)
  const shadowColor = (theme.shadowColor?.val as string | undefined) ?? palette.shadowOverlay
  const isIconHighlighted = isInputFocused || hasQuery
  const iconHighlightShadow = isDarkTheme
    ? `0 10px 24px ${shadowColor}, 0 0 0 1px rgba(45,136,255,0.28)`
    : `0 10px 24px ${shadowColor}, 0 0 0 1px rgba(45,136,255,0.14)`
  const inputHighlightShadow = isDarkTheme
    ? `0 10px 24px ${shadowColor}, 0 0 0 1px rgba(45,136,255,0.36)`
    : `0 10px 24px ${shadowColor}, 0 0 0 1px rgba(45,136,255,0.16)`
  const shellBoxShadow = isDarkTheme
    ? `0 1px 3px ${shadowColor}, 0 1px 2px ${shadowColor}`
    : '0 10px 24px rgba(28,30,33,0.08), 0 2px 8px rgba(28,30,33,0.04)'

  const borderColor = (theme.borderColor?.val as string | undefined) ?? palette.overlay
  const borderColorHoverVal = (theme.borderColorHover?.val as string | undefined) ?? borderColor
  const placeholderVal = (theme.placeholderColor?.val as string | undefined) ?? palette.overlay
  const textColor = (theme.color?.val as string | undefined) ?? '#1C1E21'
  const whiteVal = (theme.white?.val as string | undefined) ?? '#ffffff'
  const bgHoverVal = (theme.backgroundHover?.val as string | undefined) ?? iconBackgroundColor

  useEffect(() => {
    if (!isFocused) return
    translateY.setValue(-32)
    opacity.setValue(0)
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: 280,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start()
  }, [opacity, translateY, isFocused])

  return (
    <Animated.View
      style={{
        transform: [{ translateY }],
        opacity,
        position: 'relative',
        zIndex: 1,
        paddingTop: 14,
        paddingBottom: 6,
      }}
    >
      {/* RN: VirtualizedList + Tamagui stacks breaks on web (AiVehicleCard). */}
      <View style={{ width: '100%', gap: 8 }}>
        <RNText
          style={{
            fontSize: 11,
            fontWeight: '700',
            textTransform: 'uppercase',
            letterSpacing: 1.2,
            color: placeholderVal,
          }}
        >
          Conversations
        </RNText>
        <View
          style={{
            width: '100%',
            minHeight: 58,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            padding: 6,
            borderRadius: 18,
            borderWidth: 1,
            borderColor,
            backgroundColor: shellBackgroundColor,
            ...(Platform.OS === 'web'
              ? ({ boxShadow: shellBoxShadow } as const)
              : {
                  shadowColor,
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: isDarkTheme ? 0.16 : 0.08,
                  shadowRadius: isDarkTheme ? 10 : 16,
                  elevation: Platform.OS === 'android' ? 3 : 0,
                }),
          }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: isIconHighlighted ? borderColorHoverVal : iconBackgroundColor,
              borderWidth: 1,
              borderColor: isIconHighlighted ? borderColorHoverVal : 'transparent',
              flexShrink: 0,
              ...(Platform.OS === 'web'
                ? ({ boxShadow: isIconHighlighted ? iconHighlightShadow : 'none' } as const)
                : {
                    shadowColor,
                    shadowOffset: { width: 0, height: 8 },
                    shadowOpacity: isIconHighlighted ? 0.16 : 0,
                    shadowRadius: 16,
                    elevation: Platform.OS === 'android' && isIconHighlighted ? 3 : 0,
                  }),
            }}
          >
            <Search size={16} color={isIconHighlighted ? whiteVal : placeholderVal} />
          </View>
          <TextInput
            style={[
              {
                flex: 1,
                minHeight: 46,
                paddingHorizontal: 14,
                fontSize: 16,
                color: textColor,
                backgroundColor: fieldBackgroundColor,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: isInputFocused ? borderColorHoverVal : 'transparent',
              },
              Platform.OS === 'web'
                ? ({
                    boxShadow: isInputFocused ? inputHighlightShadow : 'none',
                    outlineStyle: 'none',
                    outlineWidth: 0,
                  } as object)
                : {
                    shadowColor,
                    shadowOffset: { width: 0, height: 8 },
                    shadowOpacity: isInputFocused ? 0.16 : 0,
                    shadowRadius: 16,
                    elevation: Platform.OS === 'android' && isInputFocused ? 3 : 0,
                  },
            ]}
            placeholder="Search your chats"
            placeholderTextColor={placeholderVal}
            value={searchQuery}
            onChangeText={onChangeText}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
          />
          {hasQuery ? (
            <TouchableOpacity
              onPress={() => onChangeText('')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              style={{
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 999,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: bgHoverVal,
                }}
              >
                <X size={14} color={placeholderVal} />
              </View>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Animated.View>
  )
}

// Module-level flag: prevents the single-session fast-path from re-triggering
// when the user navigates back from chat. Persists across remounts.
let didAutoNavigate = false

// ─── Main screen ───

export default function SessionsScreen() {
  const router = useRouter()
  const isFocused = useIsFocused()
  const theme = useTheme()
  const sessions = useChatStore((state) => state.sessions)
  const isLoading = useChatStore((state) => state.isLoading)
  const loadSessions = useChatStore((state) => state.loadSessions)
  const setActiveSession = useChatStore((state) => state.setActiveSession)
  const deleteSession = useChatStore((state) => state.deleteSession)
  const searchSessions = useChatStore((state) => state.searchSessions)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Session[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadSessionsWithError = useCallback(async () => {
    setLoadError(false)
    try {
      await loadSessions()
    } catch {
      setLoadError(true)
    }
  }, [loadSessions])

  // Reload sessions every time the screen gains focus (including back-navigation)
  useFocusEffect(
    useCallback(() => {
      loadSessionsWithError()
    }, [loadSessionsWithError])
  )

  // Single-session fast-path: auto-navigate to chat if exactly 1 session.
  // Uses module-level flag so navigating back from chat never re-triggers.
  useEffect(() => {
    if (Platform.OS === 'web') return
    if (didAutoNavigate) return
    if (!isLoading && sessions.length >= 1) {
      didAutoNavigate = true
      if (sessions.length === 1 && !searchQuery) {
        setActiveSession(sessions[0].id).then(() => {
          router.replace('/(app)/chat')
        })
      }
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

  const handleNew = () => {
    useChatStore.setState({
      activeSessionId: null,
      messages: [],
      aiResponseCount: 0,
      _sessionJustCreated: false,
    })
    router.push('/(app)/chat')
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

  const searchBarRow = useMemo(() => {
    if (sessions.length === 0) return null
    return (
      <View
        style={{
          width: '100%',
          alignItems: 'center',
          ...(Platform.OS === 'web' ? { overflow: 'visible' as const } : {}),
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: CHATS_SHEET_MAX_WIDTH,
            paddingHorizontal: CHATS_EDGE_INSET,
            ...(Platform.OS === 'web' ? { overflow: 'visible' as const } : {}),
          }}
        >
          <View style={{ width: '100%', paddingBottom: CHATS_LIST_BELOW_SEARCH_GAP }}>
            <SearchBar
              searchQuery={searchQuery}
              onChangeText={handleSearchChange}
              isFocused={isFocused}
            />
          </View>
        </View>
      </View>
    )
  }, [sessions.length, searchQuery, handleSearchChange, isFocused])

  const hasSearchQuery = searchQuery.trim().length > 0
  const showEmptyState = !isLoading && !loadError && sessions.length === 0 && !searchQuery
  const showEmptySearch =
    hasSearchQuery && !isSearching && !searchError && displaySessions.length === 0
  const showSearchError = hasSearchQuery && !isSearching && searchError

  return (
    <RoleGuard role="buyer">
      <ThemedSafeArea edges={['top']} style={{ overflow: 'visible' }}>
        <View style={{ flex: 1, backgroundColor: (theme.background?.val as string) ?? '#fff' }}>
          {[
            <ScreenHeader
              key="chats-header"
              leftIcon={<Settings size={22} color="$color" />}
              onLeftPress={() => router.push('/(app)/settings')}
              leftLabel="Settings"
              title={APP_NAME}
              titleKey={`${APP_NAME}-${isFocused ? 'focused' : 'blurred'}`}
              scrambleActive={isFocused}
              iconTrigger={isFocused}
              rightIcon={<MessageSquarePlus size={22} color="$color" />}
              onRightPress={handleNew}
              rightLabel="Start new chat"
            />,
            <View key="chats-body" style={{ flex: 1, overflow: 'visible' }}>
              {isLoading && sessions.length === 0 ? (
                <LoadingIndicator message="Loading your chats..." />
              ) : loadError ? (
                <ErrorState onRetry={loadSessionsWithError} />
              ) : (
                <View
                  style={{
                    flex: 1,
                    width: '100%',
                    backgroundColor: 'transparent',
                    overflow: 'visible',
                  }}
                >
                  {(showSearchError || showEmptySearch) && searchBarRow}
                  {showSearchError ? (
                    <ErrorState onRetry={() => handleSearchChange(searchQuery)} />
                  ) : showEmptySearch ? (
                    <EmptySearchState query={searchQuery} />
                  ) : showEmptyState ? (
                    <EmptySessionsState onNewChat={() => router.push('/(app)/chat')} />
                  ) : (
                    <View
                      style={{
                        flex: 1,
                        width: '100%',
                        minHeight: 0,
                        backgroundColor: 'transparent',
                        overflow: 'visible',
                      }}
                    >
                      <SectionList
                        sections={sections}
                        keyExtractor={(item) => item.id}
                        removeClippedSubviews={false}
                        ListHeaderComponent={searchBarRow ? () => searchBarRow : undefined}
                        style={
                          Platform.OS === 'web'
                            ? ({
                                flex: 1,
                                minHeight: 0,
                                width: '100%',
                                backgroundColor: 'transparent',
                                scrollbarWidth: 'thin',
                                scrollbarColor: `${theme.placeholderColor?.val ?? palette.overlay} transparent`,
                              } as any)
                            : {
                                flex: 1,
                                minHeight: 0,
                                width: '100%',
                                backgroundColor: 'transparent',
                              }
                        }
                        contentContainerStyle={{
                          flexGrow: 1,
                          backgroundColor: 'transparent',
                          paddingBottom: 16,
                        }}
                        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
                        renderSectionHeader={({ section }) =>
                          sections.length > 1 ? (
                            <View style={{ width: '100%', alignItems: 'center' }}>
                              <View
                                style={{
                                  width: '100%',
                                  maxWidth: CHATS_SHEET_MAX_WIDTH,
                                  paddingHorizontal: CHATS_EDGE_INSET,
                                }}
                              >
                                <RNText
                                  style={{
                                    fontSize: 12,
                                    fontWeight: '600',
                                    color:
                                      (theme.placeholderColor?.val as string | undefined) ??
                                      palette.overlay,
                                    textTransform: 'uppercase',
                                    letterSpacing: 0.5,
                                    marginBottom: 8,
                                    marginTop: 12,
                                  }}
                                >
                                  {section.title}
                                </RNText>
                              </View>
                            </View>
                          ) : null
                        }
                        renderItem={({ item, index }) => (
                          <View
                            style={{
                              width: '100%',
                              alignItems: 'center',
                              ...(Platform.OS === 'web' ? { overflow: 'visible' as const } : {}),
                            }}
                          >
                            <View
                              style={{
                                width: '100%',
                                maxWidth: CHATS_SHEET_MAX_WIDTH,
                                paddingHorizontal: CHATS_EDGE_INSET,
                                ...(Platform.OS === 'web' ? { overflow: 'visible' as const } : {}),
                              }}
                            >
                              <SessionCard
                                session={item}
                                index={index}
                                onSelect={handleSelect}
                                onDelete={setDeleteTarget}
                                isFocused={isFocused}
                              />
                            </View>
                          </View>
                        )}
                        refreshControl={
                          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
                        }
                        stickySectionHeadersEnabled={false}
                      />
                    </View>
                  )}
                </View>
              )}
            </View>,
          ]}
        </View>
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
