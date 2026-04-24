import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Pressable,
  ActivityIndicator,
  Platform,
  Text,
  TextInput,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
  type TextStyle,
} from 'react-native'
import { Plus, Sparkles } from '@tamagui/lucide-icons'
import { SizableText, XStack, YStack, useTheme } from 'tamagui'
import { AppCard } from '@/components/shared/AppCard'
import { AppButton } from '@/components/shared/AppButton'
import { useScreenWidth } from '@/hooks/useScreenWidth'
import { api } from '@/lib/api'
import type { DealRecapRedactionProfile } from '@/lib/types'

/** Row shape for the recap timeline (maps from API beats). */
export type RecapTimelineRow = {
  id: string
  /** What happened off the app (lot, dealer, drive). */
  world: string
  /** What Dealership AI did in chat or tools. */
  app: string
  /** ISO timestamp for ordering and optional display. */
  occurredAt?: string | null
  /** Pre-formatted date line; otherwise derived from `occurredAt`. */
  dateLabel?: string | null
  sortOrder?: number
}

type DraftRow = {
  key: string
  sourceBeatId?: string
  occurredAt: string
  world: string
  app: string
}

function newDraftKey(): string {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function midIso(isoLeft: string, isoRight: string): string {
  const a = Date.parse(isoLeft)
  const b = Date.parse(isoRight)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return new Date().toISOString()
  if (b <= a) return new Date(a + 1000).toISOString()
  return new Date(Math.floor((a + b) / 2)).toISOString()
}

function offsetEarlier(iso: string): string {
  const t = Date.parse(iso)
  const base = Number.isFinite(t) ? t : Date.now()
  return new Date(base - 3_600_000).toISOString()
}

function offsetLater(iso: string): string {
  const t = Date.parse(iso)
  const base = Number.isFinite(t) ? t : Date.now()
  return new Date(base + 3_600_000).toISOString()
}

export function formatRecapBeatDate(iso: string | null | undefined): string | null {
  if (iso == null || iso === '') return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }
  if (d.getFullYear() !== now.getFullYear()) {
    opts.year = 'numeric'
  }
  return d.toLocaleString(undefined, opts)
}

/** Read-only timeline: vertical line + brand dot between cards. */
function TimelineSpineView() {
  return (
    <YStack
      height={40}
      width="100%"
      position="relative"
      alignItems="center"
      justifyContent="center"
    >
      <YStack
        position="absolute"
        left="50%"
        marginLeft={-1}
        width={2}
        top={0}
        height="100%"
        backgroundColor="$borderColor"
      />
      <YStack
        width={12}
        height={12}
        borderRadius={999}
        backgroundColor="$brand"
        borderWidth={2}
        borderColor="$backgroundStrong"
        zIndex={1}
      />
    </YStack>
  )
}

function TimelineSpineInsertSlot({
  onPress,
  accessibilityLabel,
}: {
  onPress: () => void
  accessibilityLabel: string
}) {
  const theme = useTheme()
  const brand = (theme.brand?.val as string) ?? ''

  return (
    <YStack width="100%" alignItems="center" paddingVertical="$1">
      <YStack width={2} height={18} backgroundColor="$borderColor" />
      <Pressable
        onPress={onPress}
        style={Platform.OS === 'web' ? ({ cursor: 'pointer' } as const) : undefined}
        {...(Platform.OS === 'web'
          ? ({ 'aria-label': accessibilityLabel, role: 'button' } as const)
          : { accessibilityRole: 'button' as const, accessibilityLabel })}
      >
        <YStack
          minWidth={44}
          minHeight={44}
          alignItems="center"
          justifyContent="center"
          borderRadius={999}
          borderWidth={2}
          borderColor="$brand"
          backgroundColor="$backgroundStrong"
        >
          <Plus size={22} color={brand} strokeWidth={2.5} />
        </YStack>
      </Pressable>
      <YStack width={2} height={18} backgroundColor="$borderColor" />
    </YStack>
  )
}

function beatDateLabel(row: RecapTimelineRow): string | null {
  if (row.dateLabel != null && row.dateLabel !== '') return row.dateLabel
  return formatRecapBeatDate(row.occurredAt)
}

type BeatSectionVariant = 'split' | 'world_only' | 'app_only'

function beatVariantFromRow(row: RecapTimelineRow): {
  world: string
  app: string
  variant: BeatSectionVariant
} {
  const world = row.world.trim()
  const app = row.app.trim()
  if (!world && app) return { world: '', app, variant: 'app_only' }
  if (world && !app) return { world, app: '', variant: 'world_only' }
  if (world && app) return { world, app, variant: 'split' }
  return { world: '', app: '', variant: 'world_only' }
}

function TimelineAppSection({ text, fg }: { text: string; fg: string }) {
  const theme = useTheme()
  const brand = (theme.brand?.val as string) ?? '#2D88FF'

  return (
    <XStack
      gap="$2.5"
      padding="$2.5"
      borderRadius="$3"
      backgroundColor="$brandSubtle"
      borderLeftWidth={3}
      borderLeftColor="$brand"
      alignItems="flex-start"
      width="100%"
    >
      <Sparkles size={20} color={brand} strokeWidth={2.25} aria-hidden />
      <Text style={{ flex: 1, fontSize: 16, lineHeight: 24, color: fg, minWidth: 0 }}>{text}</Text>
    </XStack>
  )
}

function TimelineBeatSummary({ row }: { row: RecapTimelineRow }) {
  const theme = useTheme()
  const dateLabel = beatDateLabel(row)
  const { world, app, variant } = beatVariantFromRow(row)
  const fg = (theme.color?.val as string) ?? undefined
  const fgMuted = (theme.colorSecondary?.val as string) ?? undefined

  const a11yParts: string[] = []
  if (dateLabel != null) a11yParts.push(dateLabel)
  if (world.length > 0) a11yParts.push(`Outside the app: ${world}`)
  if (app.length > 0) a11yParts.push(`From the app: ${app}`)
  const a11y = a11yParts.length > 0 ? a11yParts.join('. ') : undefined

  return (
    <AppCard compact width="100%" accessibilityLabel={a11y}>
      <YStack gap="$2.5" width="100%">
        {dateLabel != null ? (
          <Text style={{ fontSize: 13, lineHeight: 18, color: fgMuted, width: '100%' }} numberOfLines={1}>
            {dateLabel}
          </Text>
        ) : null}
        {variant === 'app_only' && app.length > 0 && fg != null ? (
          <TimelineAppSection text={app} fg={fg} />
        ) : (
          <>
            {world.length > 0 && fg != null ? (
              <Text style={{ fontSize: 16, lineHeight: 24, color: fg, width: '100%' }}>{world}</Text>
            ) : null}
            {app.length > 0 && fg != null ? (
              <>
                {world.length > 0 ? <YStack width="100%" height={1} backgroundColor="$borderColor" /> : null}
                <TimelineAppSection text={app} fg={fg} />
              </>
            ) : null}
          </>
        )}
      </YStack>
    </AppCard>
  )
}

const DRAFT_INPUT_MIN_HEIGHT = 52
/** Extra slack so RN/web `contentSize` does not clip the last line or trigger an inner scrollbar. */
const DRAFT_INPUT_VERTICAL_PAD = 28
const DRAFT_LINE_HEIGHT = 22
/** ~70 chars ≈ one line at 16px in a ~720px card minus padding (web textarea wrap). */
const DRAFT_CHARS_PER_LINE_EST = 70

function estimateNarrativeInputHeight(text: string): number {
  if (text.trim().length === 0) return DRAFT_INPUT_MIN_HEIGHT
  const segments = text.split('\n')
  let lineCount = 0
  for (const seg of segments) {
    lineCount += Math.max(1, Math.ceil(seg.length / DRAFT_CHARS_PER_LINE_EST))
  }
  return Math.max(
    DRAFT_INPUT_MIN_HEIGHT,
    Math.ceil(lineCount * DRAFT_LINE_HEIGHT + DRAFT_INPUT_VERTICAL_PAD)
  )
}

function draftFieldStyle(
  fg: string,
  border: string,
  inputBg: string,
  height: number
): TextStyle {
  return {
    width: '100%',
    height,
    fontSize: 16,
    lineHeight: DRAFT_LINE_HEIGHT,
    color: fg,
    borderWidth: 1,
    borderColor: border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: inputBg,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none', overflow: 'hidden', resize: 'none' } : {}),
  } as TextStyle
}

function DraftBeatEditor({
  row,
  onChange,
  onRequestRemove,
}: {
  row: DraftRow
  onChange: (patch: Partial<DraftRow>) => void
  onRequestRemove?: () => void
}) {
  const theme = useTheme()
  const [worldH, setWorldH] = useState(() => estimateNarrativeInputHeight(row.world))
  const [appH, setAppH] = useState(() => estimateNarrativeInputHeight(row.app))

  useLayoutEffect(() => {
    setWorldH(estimateNarrativeInputHeight(row.world))
    setAppH(estimateNarrativeInputHeight(row.app))
  }, [row.key])

  const onWorldSize = useCallback((e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
    const h = e.nativeEvent.contentSize.height
    setWorldH(Math.max(DRAFT_INPUT_MIN_HEIGHT, Math.ceil(h + DRAFT_INPUT_VERTICAL_PAD)))
  }, [])
  const onAppSize = useCallback((e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
    const h = e.nativeEvent.contentSize.height
    setAppH(Math.max(DRAFT_INPUT_MIN_HEIGHT, Math.ceil(h + DRAFT_INPUT_VERTICAL_PAD)))
  }, [])

  const border = theme.borderColor?.val as string
  const fg = theme.color?.val as string
  const inputBg = (theme.backgroundHover?.val as string) ?? (theme.backgroundStrong?.val as string)
  const ph = theme.placeholderColor?.val as string

  return (
    <YStack
      width="100%"
      padding="$3"
      borderRadius={12}
      borderWidth={1}
      borderColor="$borderColor"
      backgroundColor="$backgroundStrong"
      gap="$2"
    >
      {onRequestRemove ? (
        <XStack width="100%" justifyContent="flex-end">
          <AppButton
            size="$3"
            variant="outline"
            onPress={onRequestRemove}
            minHeight={40}
            accessibilityLabel="Remove this beat from the timeline"
          >
            Remove beat
          </AppButton>
        </XStack>
      ) : null}
      <YStack gap="$1" width="100%">
        <SizableText size="$2" fontWeight="600" color="$color">
          Off the app
        </SizableText>
        <TextInput
          accessibilityLabel="What happened off the app for this moment"
          placeholder="Lot, dealer, drive, what you saw or heard"
          placeholderTextColor={ph}
          value={row.world}
          onChangeText={(t) => onChange({ world: t })}
          multiline
          scrollEnabled={false}
          textAlignVertical="top"
          onContentSizeChange={onWorldSize}
          style={draftFieldStyle(fg, border, inputBg, worldH)}
        />
      </YStack>
      <YStack gap="$1" width="100%">
        <SizableText size="$2" fontWeight="600" color="$brand">
          From the app
        </SizableText>
        <TextInput
          accessibilityLabel="What the app did for this moment"
          placeholder="Numbers, flags, assistant messages (or leave blank)"
          placeholderTextColor={ph}
          value={row.app}
          onChangeText={(t) => onChange({ app: t })}
          multiline
          scrollEnabled={false}
          textAlignVertical="top"
          onContentSizeChange={onAppSize}
          style={draftFieldStyle(fg, border, inputBg, appH)}
        />
      </YStack>
    </YStack>
  )
}

function TimelineEdgeInsertButton({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <AppButton size="$4" variant="outline" onPress={onPress} minHeight={44}>
      {label}
    </AppButton>
  )
}

function reportTimelineError(
  title: string,
  message: string,
  onError?: (title: string, message: string) => void
): void {
  if (onError) {
    onError(title, message)
    return
  }
  Alert.alert(title, message)
}

export function RecapVerticalTimeline({
  rows,
  title = 'Timeline',
  subtitle,
  eventCount,
  sessionId,
  activeDealId,
  onTimelinePersisted,
  getRegenerateRedactionProfile,
  onEditingChange,
  onError,
}: {
  rows: RecapTimelineRow[]
  title?: string
  subtitle?: string
  eventCount?: number
  sessionId?: string
  activeDealId?: string | null
  onTimelinePersisted?: () => void | Promise<void>
  /** AI preference toggles — passed to recap generate on Save and regenerate only. */
  getRegenerateRedactionProfile?: () => DealRecapRedactionProfile
  /** Fires when the user enters or leaves timeline edit mode (for disabling share/export until saved). */
  onEditingChange?: (editing: boolean) => void
  /** Prefer over Alert on web for inline errors. */
  onError?: (title: string, message: string) => void
}) {
  const { width: screenW } = useScreenWidth()
  const stackTimelineActions = screenW < 540

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const ta = a.occurredAt != null ? Date.parse(a.occurredAt) : Number.NaN
      const tb = b.occurredAt != null ? Date.parse(b.occurredAt) : Number.NaN
      if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return ta - tb
      const sa = a.sortOrder ?? 0
      const sb = b.sortOrder ?? 0
      if (sa !== sb) return sa - sb
      return a.id.localeCompare(b.id)
    })
  }, [rows])

  const [editing, setEditing] = useState(false)
  const [draftRows, setDraftRows] = useState<DraftRow[]>([])
  const [saving, setSaving] = useState<'save' | 'regenerate' | null>(null)
  const initialSnapshotRef = useRef<Map<string, { world: string; app: string }>>(new Map())

  const enterEdit = useCallback(() => {
    const m = new Map<string, { world: string; app: string }>()
    sorted.forEach((r) => {
      m.set(r.id, { world: r.world, app: r.app })
    })
    initialSnapshotRef.current = m
    setDraftRows(
      sorted.map((r) => ({
        key: r.id,
        sourceBeatId: r.id,
        occurredAt: r.occurredAt ?? new Date().toISOString(),
        world: r.world,
        app: r.app,
      }))
    )
    setEditing(true)
    onEditingChange?.(true)
  }, [sorted, onEditingChange])

  const cancelEdit = useCallback(() => {
    onEditingChange?.(false)
    setEditing(false)
    setDraftRows([])
  }, [onEditingChange])

  const updateDraft = useCallback((key: string, patch: Partial<DraftRow>) => {
    setDraftRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }, [])

  const insertBefore = useCallback(() => {
    setDraftRows((prev) => {
      if (prev.length === 0) {
        return [
          {
            key: newDraftKey(),
            occurredAt: new Date().toISOString(),
            world: '',
            app: '',
          },
        ]
      }
      const t = offsetEarlier(prev[0].occurredAt)
      return [
        { key: newDraftKey(), occurredAt: t, world: '', app: '' },
        ...prev,
      ]
    })
  }, [])

  const insertAfter = useCallback(() => {
    setDraftRows((prev) => {
      if (prev.length === 0) {
        return [
          {
            key: newDraftKey(),
            occurredAt: new Date().toISOString(),
            world: '',
            app: '',
          },
        ]
      }
      const last = prev[prev.length - 1]
      return [...prev, { key: newDraftKey(), occurredAt: offsetLater(last.occurredAt), world: '', app: '' }]
    })
  }, [])

  const removeDraftRow = useCallback((key: string) => {
    setDraftRows((prev) => prev.filter((r) => r.key !== key))
  }, [])

  const confirmRemoveDraft = useCallback(
    (key: string) => {
      if (Platform.OS === 'web') {
        const ok = window.confirm(
          'Remove this beat? It will be dropped from your timeline when you save and regenerate.'
        )
        if (ok) removeDraftRow(key)
        return
      }
      Alert.alert(
        'Remove this beat?',
        'It will be dropped from your timeline when you save and regenerate.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => removeDraftRow(key) },
        ]
      )
    },
    [removeDraftRow]
  )

  const insertBetween = useCallback((leftIndex: number) => {
    setDraftRows((prev) => {
      const a = prev[leftIndex]
      const b = prev[leftIndex + 1]
      if (a == null || b == null) return prev
      const t = midIso(a.occurredAt, b.occurredAt)
      const row: DraftRow = { key: newDraftKey(), occurredAt: t, world: '', app: '' }
      const next = [...prev]
      next.splice(leftIndex + 1, 0, row)
      return next
    })
  }, [])

  const postDraftChanges = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    const initial = initialSnapshotRef.current
    const initialSourceIds = new Set(initial.keys())
    const currentSourceIds = new Set(
      draftRows.map((d) => d.sourceBeatId).filter((id): id is string => Boolean(id))
    )
    for (const removedId of initialSourceIds) {
      if (!currentSourceIds.has(removedId)) {
        await api.addDealRecapTimelineEvent(sessionId, {
          kind: 'user_beat_removal',
          world: '',
          app: '',
          supersedesEventId: removedId,
          dealId: activeDealId ?? null,
        })
      }
    }
    for (const d of draftRows) {
      const w = d.world.trim()
      const a = d.app.trim()
      if (!d.sourceBeatId) {
        if (!w && !a) continue
        await api.addDealRecapTimelineEvent(sessionId, {
          kind: 'user_note',
          world: w,
          app: a,
          occurredAt: d.occurredAt,
          dealId: activeDealId ?? null,
        })
        continue
      }
      const prev = initial.get(d.sourceBeatId)
      if (!prev) continue
      if (prev.world === d.world && prev.app === d.app) continue
      if (!w && !a) continue
      await api.addDealRecapTimelineEvent(sessionId, {
        kind: 'user_correction',
        world: d.world,
        app: d.app,
        supersedesEventId: d.sourceBeatId,
        dealId: activeDealId ?? null,
      })
    }
  }, [sessionId, activeDealId, draftRows])

  const saveAsIs = useCallback(async () => {
    if (!sessionId) return
    setSaving('save')
    try {
      await postDraftChanges()
      await onTimelinePersisted?.()
      onEditingChange?.(false)
      setEditing(false)
      setDraftRows([])
    } catch (e) {
      reportTimelineError(
        'Could not save timeline',
        e instanceof Error ? e.message : 'Unknown error',
        onError
      )
    } finally {
      setSaving(null)
    }
  }, [sessionId, postDraftChanges, onTimelinePersisted, onError, onEditingChange])

  const saveAndRegenerate = useCallback(async () => {
    if (!sessionId) return
    setSaving('regenerate')
    try {
      await postDraftChanges()
      await api.generateDealRecap(sessionId, {
        force: true,
        ...(getRegenerateRedactionProfile != null
          ? { redaction: getRegenerateRedactionProfile() }
          : {}),
      })
      await onTimelinePersisted?.()
      onEditingChange?.(false)
      setEditing(false)
      setDraftRows([])
    } catch (e) {
      reportTimelineError(
        'Could not save or regenerate',
        e instanceof Error ? e.message : 'Unknown error',
        onError
      )
    } finally {
      setSaving(null)
    }
  }, [sessionId, postDraftChanges, onTimelinePersisted, onError, getRegenerateRedactionProfile, onEditingChange])

  const count = eventCount ?? rows.length

  if (sorted.length === 0 && !editing) {
    if (!sessionId) return null
    return (
      <YStack gap="$3" width="100%" alignItems="stretch">
        <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
          <YStack flex={1} minWidth={200} gap="$1">
            <SizableText size="$5" fontWeight="800" color="$color">
              {title}
            </SizableText>
            <SizableText size="$2" color="$colorMuted">
              {subtitle ?? 'No moments yet. Generate a recap, or add your own.'}
            </SizableText>
          </YStack>
          <AppButton size="$4" variant="outline" onPress={enterEdit} minHeight={44}>
            Edit timeline
          </AppButton>
        </XStack>
      </YStack>
    )
  }

  const defaultSubtitle = sessionId
    ? `Short story of this deal in ${count} part${count === 1 ? '' : 's'} · Edit to add, fix, or remove beats`
    : `Short story of this deal in ${count} part${count === 1 ? '' : 's'}`

  const narrowEditingHeader = Boolean(sessionId && editing && stackTimelineActions)

  return (
    <YStack gap="$3" width="100%" alignItems="stretch">
      <XStack
        justifyContent="space-between"
        alignItems={narrowEditingHeader ? 'stretch' : 'center'}
        flexDirection={narrowEditingHeader ? 'column' : 'row'}
        gap="$3"
        flexWrap="wrap"
        width="100%"
      >
        <YStack flex={narrowEditingHeader ? undefined : 1} minWidth={200} gap="$1" width={narrowEditingHeader ? '100%' : undefined}>
          <SizableText size="$5" fontWeight="800" color="$color">
            {title}
          </SizableText>
          <SizableText size="$2" color="$colorMuted">
            {subtitle ?? defaultSubtitle}
          </SizableText>
        </YStack>
        {sessionId && !editing ? (
          <AppButton size="$4" variant="outline" onPress={enterEdit} minHeight={44}>
            Edit timeline
          </AppButton>
        ) : null}
        {sessionId && editing ? (
          stackTimelineActions ? (
            <YStack width="100%" gap="$2" alignItems="stretch">
              <AppButton size="$4" variant="outline" onPress={cancelEdit} disabled={saving !== null} minHeight={44}>
                Cancel
              </AppButton>
              <AppButton
                size="$4"
                variant="outline"
                onPress={() => void saveAsIs()}
                disabled={saving !== null}
                minHeight={44}
              >
                {saving === 'save' ? 'Saving…' : 'Save'}
              </AppButton>
              <AppButton
                size="$4"
                variant="primary"
                onPress={() => void saveAndRegenerate()}
                disabled={saving !== null}
                minHeight={44}
              >
                {saving === 'regenerate' ? 'Regenerating…' : 'Save and regenerate'}
              </AppButton>
              {saving !== null ? (
                <XStack justifyContent="center" paddingVertical="$1">
                  <ActivityIndicator />
                </XStack>
              ) : null}
            </YStack>
          ) : (
            <XStack gap="$2" flexWrap="wrap" alignItems="center">
              <AppButton size="$4" variant="outline" onPress={cancelEdit} disabled={saving !== null} minHeight={44}>
                Cancel
              </AppButton>
              <AppButton
                size="$4"
                variant="outline"
                onPress={() => void saveAsIs()}
                disabled={saving !== null}
                minHeight={44}
              >
                {saving === 'save' ? 'Saving…' : 'Save'}
              </AppButton>
              <AppButton
                size="$4"
                variant="primary"
                onPress={() => void saveAndRegenerate()}
                disabled={saving !== null}
                minHeight={44}
              >
                {saving === 'regenerate' ? 'Regenerating…' : 'Save and regenerate'}
              </AppButton>
              {saving !== null ? <ActivityIndicator /> : null}
            </XStack>
          )
        ) : null}
      </XStack>

      {!editing && sorted.length === 0 ? null : editing ? (
        <YStack width="100%" alignItems="stretch" gap="$3">
          <YStack
            padding="$3"
            borderRadius="$3"
            borderWidth={1}
            borderColor="$borderColor"
            backgroundColor="$backgroundStrong"
            gap="$2"
          >
            <SizableText size="$2" fontWeight="600" color="$color">
              How editing works
            </SizableText>
            <SizableText size="$2" color="$colorSecondary" lineHeight={22}>
              Add notes before the first card, between cards, or after the last. Each card has two fields: what
              happened off the app, and what Dealership AI did (leave either blank if it does not apply). Use Remove
              beat on a card to drop it when you save. Save keeps your edits on the server as-is; Save and regenerate
              runs the recap model again on the latest timeline.
            </SizableText>
          </YStack>
          <AppCard
            compact
            width="100%"
            gap="$3"
            alignItems="stretch"
            accessibilityLabel="Timeline editor"
            interactive={false}
          >
            <TimelineEdgeInsertButton onPress={insertBefore} label="Add before first" />
            {draftRows.map((dr, index) => (
              <YStack key={dr.key} width="100%" alignItems="stretch">
                {index > 0 ? (
                  <TimelineSpineInsertSlot
                    onPress={() => insertBetween(index - 1)}
                    accessibilityLabel="Add moment between these steps"
                  />
                ) : null}
                <DraftBeatEditor
                  row={dr}
                  onChange={(p) => updateDraft(dr.key, p)}
                  onRequestRemove={() => confirmRemoveDraft(dr.key)}
                />
              </YStack>
            ))}
            <TimelineEdgeInsertButton onPress={insertAfter} label="Add after last" />
          </AppCard>
        </YStack>
      ) : (
        <YStack
          width="100%"
          gap="$3"
          alignItems="stretch"
          padding="$3"
          borderRadius="$3"
          borderWidth={1}
          borderColor="$borderColor"
          backgroundColor="$backgroundStrong"
          {...(Platform.OS === 'web'
            ? ({ 'aria-label': 'Timeline' } as const)
            : { accessibilityLabel: 'Timeline' })}
        >
          {sorted.map((row, index) => (
            <YStack key={row.id} width="100%" alignItems="stretch">
              {index > 0 ? <TimelineSpineView /> : null}
              <TimelineBeatSummary row={row} />
            </YStack>
          ))}
        </YStack>
      )}
    </YStack>
  )
}
