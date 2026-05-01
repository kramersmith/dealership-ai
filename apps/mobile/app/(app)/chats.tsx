import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FlatList,
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
  CopilotPageHero,
  CopilotTopNav,
  ThemedSafeArea,
  LoadingIndicator,
  RoleGuard,
  ConfirmModal,
  AppButton,
} from '@/components/shared'
import { useRouter } from 'expo-router'
import {
  ArrowDownUp,
  Calendar,
  ListFilter,
  MessageSquarePlus,
  Search,
  Settings,
  X,
} from '@tamagui/lucide-icons'
import { useIsFocused } from '@react-navigation/native'
import type { Session } from '@/lib/types'
import { useChatStore } from '@/stores/chatStore'
import { useFocusEffect } from 'expo-router'
import { useFadeIn } from '@/hooks/useAnimatedValue'
import { webScrollbarStyle } from '@/lib/scrollbarStyles'
import { FilterChip, SessionCard, type FilterChipOption } from '@/components/chats'
import { DEAL_PHASES } from '@/lib/constants'
import type { DealPhase } from '@/lib/types'
import { palette } from '@/lib/theme/tokens'

/** Target width for search + cards (inside horizontal insets). */
const CHATS_CONTENT_MAX_WIDTH = 720
/**
 * Same horizontal inset on the search row and on FlatList rows so the column aligns while scrolling.
 * ScrollViews clip to their bounds — shadows must draw inside this inset, not only on outer wrappers.
 */
const CHATS_EDGE_INSET = 24
const CHATS_SHEET_MAX_WIDTH = CHATS_CONTENT_MAX_WIDTH + 2 * CHATS_EDGE_INSET
/** Space below the search (list header) before the first card. */
const CHATS_LIST_BELOW_SEARCH_GAP = 12

// ─── Filter / Sort ───

type SortKey = 'recent' | 'oldest' | 'title'
/** "all" = no phase filter; otherwise a specific deal phase. */
type PhaseFilter = 'all' | DealPhase
/** `null` = any time; otherwise the rolling window in days from "now". */
type DaysWindow = null | 7 | 14 | 30 | 60 | 90 | 180 | 365

const SORT_OPTIONS: readonly FilterChipOption<SortKey>[] = [
  { value: 'recent', label: 'Most recent' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title', label: 'Title A → Z' },
] as const

const PHASE_OPTIONS: readonly FilterChipOption<PhaseFilter>[] = [
  { value: 'all', label: 'All phases' },
  ...DEAL_PHASES.map((p) => ({ value: p.key, label: p.label }) as const),
] as const

const DAYS_WINDOW_OPTIONS: readonly FilterChipOption<string>[] = [
  { value: 'any', label: 'Any time' },
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '60', label: 'Last 60 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 6 months' },
  { value: '365', label: 'Last year' },
] as const

function daysWindowToValue(window: DaysWindow): string {
  return window === null ? 'any' : String(window)
}

function valueToDaysWindow(value: string): DaysWindow {
  if (value === 'any') return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? (n as DaysWindow) : null
}

function sessionTimestamp(s: Session): number {
  const t = Date.parse(s.updatedAt)
  return Number.isFinite(t) ? t : 0
}

function applyFiltersAndSort(
  sessions: Session[],
  phase: PhaseFilter,
  daysWindow: DaysWindow,
  sort: SortKey
): Session[] {
  // Rolling window: keep sessions whose `updatedAt` falls within the last N
  // days from "now" (inclusive of today). `null` = no date filter.
  const windowFloor = daysWindow == null ? null : Date.now() - daysWindow * 24 * 60 * 60 * 1000

  const filtered = sessions.filter((s) => {
    if (phase !== 'all' && s.dealSummary?.phase !== phase) return false
    if (windowFloor != null && sessionTimestamp(s) < windowFloor) return false
    return true
  })

  const next = [...filtered]
  switch (sort) {
    case 'oldest':
      next.sort((a, b) => sessionTimestamp(a) - sessionTimestamp(b))
      break
    case 'title':
      next.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''))
      break
    case 'recent':
    default:
      next.sort((a, b) => sessionTimestamp(b) - sessionTimestamp(a))
      break
  }
  return next
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
  total,
  shown,
}: {
  searchQuery: string
  onChangeText: (text: string) => void
  /** Right-aligned counter ("94 chats" / "12 of 94 chats") on the same row
   *  as the "Conversations" label. Hidden when the parent has no totals to
   *  show (e.g. empty state). */
  total?: number
  shown?: number
}) {
  const theme = useTheme()
  const themeName = useThemeName()
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

  // Static chrome — no entrance animation. Re-mounting the chats screen on
  // back-navigation would otherwise replay the fade as a "flash"; pro chat-list
  // surfaces (Linear / Notion / Slack / ChatGPT) render search statically.
  return (
    <View
      style={{
        position: 'relative',
        zIndex: 1,
        paddingTop: 14,
        paddingBottom: 6,
      }}
    >
      {/* RN: VirtualizedList + Tamagui stacks breaks on web (AiVehicleCard). */}
      <View style={{ width: '100%', gap: 8 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
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
          {total != null && total > 0 ? (
            <RNText
              style={{
                fontSize: 12,
                color: palette.slate500,
                letterSpacing: 0.2,
              }}
            >
              {shown != null && shown !== total
                ? `${shown} of ${total} ${total === 1 ? 'chat' : 'chats'}`
                : `${total} ${total === 1 ? 'chat' : 'chats'}`}
            </RNText>
          ) : null}
        </View>
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
    </View>
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
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>('all')
  const [daysWindow, setDaysWindow] = useState<DaysWindow>(null)
  const [sortKey, setSortKey] = useState<SortKey>('recent')
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

  const displaySessions = useMemo(
    () => applyFiltersAndSort(searchResults ?? sessions, phaseFilter, daysWindow, sortKey),
    [searchResults, sessions, phaseFilter, daysWindow, sortKey]
  )

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
              total={sessions.length}
              shown={displaySessions.length}
            />
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 8,
                paddingTop: 8,
              }}
            >
              <FilterChip
                icon={ListFilter}
                label="Status"
                value={phaseFilter}
                options={PHASE_OPTIONS}
                onSelect={setPhaseFilter}
                active={phaseFilter !== 'all'}
              />
              <FilterChip
                icon={Calendar}
                label="Last…"
                value={daysWindowToValue(daysWindow)}
                options={DAYS_WINDOW_OPTIONS}
                onSelect={(v) => setDaysWindow(valueToDaysWindow(v))}
                active={daysWindow !== null}
              />
              <FilterChip
                icon={ArrowDownUp}
                label="Sort By"
                value={sortKey}
                options={SORT_OPTIONS}
                onSelect={setSortKey}
                active={sortKey !== 'recent'}
              />
            </View>
          </View>
        </View>
      </View>
    )
  }, [
    sessions.length,
    displaySessions.length,
    searchQuery,
    handleSearchChange,
    phaseFilter,
    daysWindow,
    sortKey,
  ])

  const hasSearchQuery = searchQuery.trim().length > 0
  const showEmptyState = !isLoading && !loadError && sessions.length === 0 && !searchQuery
  const showEmptySearch =
    hasSearchQuery && !isSearching && !searchError && displaySessions.length === 0
  const showSearchError = hasSearchQuery && !isSearching && searchError

  const topNav = (
    <CopilotTopNav
      leftIcon={<Settings size={20} color={palette.slate400} />}
      onLeftPress={() => router.push('/(app)/settings')}
      leftLabel="Settings"
      rightIcon={<MessageSquarePlus size={20} color={palette.slate400} />}
      onRightPress={handleNew}
      rightLabel="Start new chat"
      iconTrigger={isFocused}
      paddingHorizontal={CHATS_EDGE_INSET}
    />
  )

  const heroRow = (
    <View
      style={{
        width: '100%',
        alignItems: 'center',
        paddingTop: 8,
        paddingBottom: 4,
      }}
    >
      <View
        style={{
          width: '100%',
          maxWidth: CHATS_SHEET_MAX_WIDTH,
          paddingHorizontal: CHATS_EDGE_INSET,
        }}
      >
        <CopilotPageHero
          leading="Pick up a"
          accent="conversation"
          description={
            sessions.length > 0
              ? 'Resume an active deal or start a fresh chat.'
              : 'Start a new chat to get help with your car deal.'
          }
          isDesktop={false}
          caption={null}
        />
      </View>
    </View>
  )

  // Build the unified data array consumed by FlatList: hero first (scrolls
  // away with content), then the search/filters/count row pinned via
  // `stickyHeaderIndices`, then the session cards. Putting all three in one
  // typed list lets `stickyHeaderIndices` reference the search row by index
  // (FlatList's sticky behavior counts data items, not ListHeaderComponent).
  type ChatsListItem =
    | { kind: 'hero' }
    | { kind: 'searchRow' }
    | { kind: 'session'; session: Session; index: number }

  const chatsListItems: ChatsListItem[] = [
    { kind: 'hero' },
    { kind: 'searchRow' },
    ...displaySessions.map((session, index) => ({
      kind: 'session' as const,
      session,
      index,
    })),
  ]

  return (
    <RoleGuard role="buyer">
      <ThemedSafeArea edges={['top']} style={{ overflow: 'visible' }}>
        <View style={{ flex: 1, backgroundColor: (theme.background?.val as string) ?? '#fff' }}>
          {[
            <View key="chats-nav">{topNav}</View>,
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
                  {showSearchError || showEmptySearch ? heroRow : null}
                  {(showSearchError || showEmptySearch) && searchBarRow}
                  {showSearchError ? (
                    <ErrorState onRetry={() => handleSearchChange(searchQuery)} />
                  ) : showEmptySearch ? (
                    <EmptySearchState query={searchQuery} />
                  ) : showEmptyState ? (
                    <>
                      {heroRow}
                      <EmptySessionsState onNewChat={() => router.push('/(app)/chat')} />
                    </>
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
                      <FlatList<ChatsListItem>
                        data={chatsListItems}
                        keyExtractor={(item, index) =>
                          item.kind === 'session' ? item.session.id : `${item.kind}-${index}`
                        }
                        removeClippedSubviews={false}
                        // Pin the search/filters/count row (index 1) so it
                        // stays at the top while the hero (index 0) and
                        // session cards scroll under it.
                        stickyHeaderIndices={[1]}
                        style={
                          {
                            flex: 1,
                            minHeight: 0,
                            width: '100%',
                            backgroundColor: 'transparent',
                            ...webScrollbarStyle,
                          } as any
                        }
                        contentContainerStyle={{
                          flexGrow: 1,
                          backgroundColor: 'transparent',
                          paddingBottom: 16,
                        }}
                        renderItem={({ item }) => {
                          if (item.kind === 'hero') return heroRow
                          if (item.kind === 'searchRow') {
                            // Frosted-glass sticky surface: cards underneath
                            // fade out softly behind the search row instead
                            // of hard-cutting at a solid edge. The faint
                            // bottom border carries the "above this is more
                            // content" cue without needing a scroll listener.
                            return (
                              <View
                                style={{
                                  // Lower bg opacity so cards show through
                                  // clearly; let the heavier blur carry the
                                  // "frosted" feel and keep text behind
                                  // legibly soft (Apple-Mail-style).
                                  backgroundColor: 'rgba(3, 7, 18, 0.55)',
                                  borderBottomWidth: 1,
                                  borderBottomColor: palette.ghostBgSubtle,
                                  ...(Platform.OS === 'web'
                                    ? ({
                                        backdropFilter: 'blur(16px) saturate(1.1)',
                                        WebkitBackdropFilter: 'blur(16px) saturate(1.1)',
                                      } as any)
                                    : {}),
                                }}
                              >
                                {searchBarRow}
                              </View>
                            )
                          }
                          return (
                            <View
                              style={{
                                width: '100%',
                                alignItems: 'center',
                                // First card gets extra top inset so it sits
                                // visibly below the sticky search row instead
                                // of crashing into its hairline border.
                                paddingTop: item.index === 0 ? 20 : 0,
                                paddingBottom: 12,
                                ...(Platform.OS === 'web' ? { overflow: 'visible' as const } : {}),
                              }}
                            >
                              <View
                                style={{
                                  width: '100%',
                                  maxWidth: CHATS_SHEET_MAX_WIDTH,
                                  paddingHorizontal: CHATS_EDGE_INSET,
                                  ...(Platform.OS === 'web'
                                    ? { overflow: 'visible' as const }
                                    : {}),
                                }}
                              >
                                <SessionCard
                                  session={item.session}
                                  index={item.index}
                                  onSelect={handleSelect}
                                  onDelete={setDeleteTarget}
                                  isFocused={isFocused}
                                />
                              </View>
                            </View>
                          )
                        }}
                        refreshControl={
                          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
                        }
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
