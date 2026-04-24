import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Platform, ScrollView, Share, Switch as RNSwitch } from 'react-native'
import { YStack, XStack, Text, Spinner, useTheme } from 'tamagui'
import { ChevronLeft } from '@tamagui/lucide-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  ScreenHeader,
  ThemedSafeArea,
  LoadingIndicator,
  AppCard,
  AppButton,
} from '@/components/shared'
import { RecapVerticalTimeline, type RecapTimelineRow } from '@/components/recap/RecapVerticalTimeline'
import { api } from '@/lib/api'
import { appScrollViewChromeStyle } from '@/lib/appScrollViewStyle'
import { buildDealRecapPdfHtml, type RecapPdfVariant } from '@/lib/recapPdfHtml'
import { buildRecapSavingsGlance } from '@/lib/recapSavingsNarrative'
import { shareDealRecapPdfFromHtml } from '@/lib/shareDealRecapPdf'
import { shareDealRecapPngFromHtml } from '@/lib/shareDealRecapPng'
import { palette } from '@/lib/theme/tokens'
import { useScreenWidth } from '@/hooks/useScreenWidth'
import type {
  DealRecap,
  DealRecapPublicBeat,
  DealRecapRedactionProfile,
  DealRecapSavingsSnapshot,
  DealRecapTimelineBeat,
} from '@/lib/types'

/** Share-preview / export: no toggle-driven masking — same story as GET /recap on screen. */
const SHARE_PREVIEW_UNMASKED: DealRecapRedactionProfile = {
  hideUserMessageQuotes: false,
  hideDealerName: false,
  hideDollarAmounts: false,
}

/** Resolve `world` / `app` from payload or share-preview beats; migrate legacy title/narrative into `world`. */
function recapBeatWorldApp(b: DealRecapTimelineBeat | DealRecapPublicBeat): { world: string; app: string } {
  const strField = (p: Record<string, unknown>, k: string) => {
    const v = p[k]
    return typeof v === 'string' ? v.trim() : ''
  }
  if ('payload' in b) {
    const raw = (b as DealRecapTimelineBeat).payload
    if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
      const p = raw as Record<string, unknown>
      const world = strField(p, 'world') || strField(p, 'World')
      const app = strField(p, 'app') || strField(p, 'App')
      if (world.length > 0 || app.length > 0) {
        return { world, app }
      }
      const t = strField(p, 'title') || strField(p, 'Title')
      const n = strField(p, 'narrative') || strField(p, 'Narrative')
      if (t.length > 0 && n.length > 0) return { world: `${t} ${n}`.trim(), app: '' }
      return { world: t || n, app: '' }
    }
  }
  const pb = b as DealRecapPublicBeat
  return {
    world: typeof pb.world === 'string' ? pb.world.trim() : '',
    app: typeof pb.app === 'string' ? pb.app.trim() : '',
  }
}

function formatRecapMoneyUsd(value: number): string {
  return `$${Math.round(value).toLocaleString()}`
}

function formatRecapApr(aprPercent: number): string {
  const digits = aprPercent >= 10 ? 2 : 3
  return `${aprPercent.toFixed(digits)}%`
}

/** Cursor’s web harness and some browsers stub `alert`/`Alert`; use a visible fallback when needed. */
function recapNotify(title: string, message?: string) {
  const full = message ? `${title}\n\n${message}` : title
  if (Platform.OS === 'web') {
    window.alert(full)
    return
  }
  if (message != null) {
    Alert.alert(title, message)
  } else {
    Alert.alert(title)
  }
}

async function shareRecapText(title: string, message: string): Promise<void> {
  if (Platform.OS !== 'web') {
    await Share.share({ title, message })
    return
  }
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  if (nav?.share) {
    try {
      await nav.share({ title, text: message })
      return
    } catch (e) {
      const aborted =
        (e instanceof DOMException && e.name === 'AbortError') ||
        (e instanceof Error && e.name === 'AbortError')
      if (aborted) return
    }
  }
  if (nav?.clipboard?.writeText) {
    await nav.clipboard.writeText(message)
    window.alert('Recap copied to clipboard (web).')
    return
  }
  window.prompt('Copy this recap text:', message)
}

/** Small section label — common pattern for dashboard / detail pages. */
function RecapSectionLabel({ children }: { children: string }) {
  return (
    <Text
      fontSize={11}
      fontWeight="700"
      letterSpacing={1.1}
      color="$placeholderColor"
      textTransform="uppercase"
      marginBottom="$2"
    >
      {children}
    </Text>
  )
}

function buildRecapSavingsTiles(s: DealRecapSavingsSnapshot): { key: string; label: string; value: string }[] {
  const tiles: { key: string; label: string; value: string }[] = []
  if (s.firstOffer != null) {
    tiles.push({ key: 'first_offer', label: 'First offer', value: formatRecapMoneyUsd(s.firstOffer) })
  }
  if (s.currentOffer != null) {
    tiles.push({ key: 'current_offer', label: 'Current offer', value: formatRecapMoneyUsd(s.currentOffer) })
  }
  if (s.concessionVsFirstOffer != null) {
    tiles.push({
      key: 'concession',
      label: 'Concession vs first offer',
      value: formatRecapMoneyUsd(s.concessionVsFirstOffer),
    })
  }
  if (s.monthlyPayment != null) {
    tiles.push({
      key: 'monthly',
      label: 'Monthly payment',
      value: formatRecapMoneyUsd(s.monthlyPayment),
    })
  }
  if (s.aprPercent != null) {
    tiles.push({ key: 'apr', label: 'APR', value: formatRecapApr(s.aprPercent) })
  }
  if (s.loanTermMonths != null) {
    tiles.push({ key: 'term', label: 'Loan term', value: `${s.loanTermMonths} mo` })
  }
  if (s.estimatedTotalInterestDeltaUsd != null) {
    tiles.push({
      key: 'interest_delta',
      label: 'Interest vs +1% APR (est.)',
      value: formatRecapMoneyUsd(s.estimatedTotalInterestDeltaUsd),
    })
  }
  return tiles
}

function RecapSavingsSnapshotCard({ savings }: { savings: DealRecapSavingsSnapshot }) {
  const glance = buildRecapSavingsGlance(savings)
  const tiles = buildRecapSavingsTiles(savings)
  const hasTiles = tiles.length > 0
  const assumptionLines = savings.assumptions.slice(0, 4)
  const assumptionOverflow = savings.assumptions.length - assumptionLines.length
  const hasAssumptions = assumptionLines.length > 0

  return (
    <>
      {glance.hasAny ? (
        <YStack
          marginTop="$3"
          padding="$3"
          borderRadius="$3"
          borderWidth={1}
          borderColor="$borderColor"
          backgroundColor="$brandSubtle"
          borderLeftWidth={4}
          borderLeftColor="$brand"
          alignSelf="stretch"
        >
          <Text
            fontSize={11}
            fontWeight="700"
            letterSpacing={1.1}
            color="$brand"
            textTransform="uppercase"
            marginBottom="$2"
          >
            Your deal in one glance
          </Text>
          {glance.headline ? (
            <Text fontSize="$4" lineHeight={24} color="$color" fontWeight="600">
              {glance.headline}
            </Text>
          ) : null}
          {glance.bridge ? (
            <Text fontSize="$3" lineHeight={22} color="$colorSecondary" marginTop={glance.headline ? '$2' : 0}>
              {glance.bridge}
            </Text>
          ) : null}
          {glance.interest ? (
            <Text fontSize="$3" lineHeight={22} color="$color" marginTop="$2">
              {glance.interest}
            </Text>
          ) : null}
        </YStack>
      ) : null}
      {hasTiles ? (
        <XStack flexWrap="wrap" gap="$2" marginTop="$3">
          {tiles.map((t) => (
            <YStack
              key={t.key}
              flexGrow={1}
              flexBasis="48%"
              minWidth={140}
              padding="$3"
              borderRadius="$3"
              backgroundColor="$backgroundHover"
              borderWidth={1}
              borderColor="$borderColor"
            >
              <Text fontSize="$2" color="$colorSecondary" fontWeight="600">
                {t.label}
              </Text>
              <Text fontSize={22} fontWeight="700" color="$color" marginTop="$1">
                {t.value}
              </Text>
            </YStack>
          ))}
        </XStack>
      ) : null}
      {!hasTiles && !hasAssumptions && !glance.hasAny ? (
        <Text fontSize="$3" lineHeight={22} color="$color" marginTop="$3">
          No offer or financing numbers are on this deal yet. Add them in chat (or your deal sheet),
          then tap Generate Recap to populate this section.
        </Text>
      ) : null}
      {hasAssumptions ? (
        <YStack marginTop="$3" gap="$2" width="100%">
          <Text fontSize="$2" fontWeight="700" color="$color">
            How we calculated this
          </Text>
          {assumptionLines.map((line, i) => (
            <XStack key={i} width="100%" alignItems="flex-start" gap="$2">
              <Text
                flexShrink={0}
                width={16}
                paddingTop={2}
                fontSize="$2"
                lineHeight={21}
                color="$colorSecondary"
                textAlign="center"
              >
                •
              </Text>
              <YStack flex={1} minWidth={0}>
                <Text fontSize="$2" lineHeight={21} color="$color">
                  {line}
                </Text>
              </YStack>
            </XStack>
          ))}
          {assumptionOverflow > 0 ? (
            <Text fontSize="$2" color="$placeholderColor" marginTop="$1">
              +{assumptionOverflow} more calculation note{assumptionOverflow === 1 ? '' : 's'}.
            </Text>
          ) : null}
        </YStack>
      ) : null}
      <Text fontSize="$2" lineHeight={20} color="$colorMuted" marginTop="$3">
        {savings.disclaimer}
      </Text>
    </>
  )
}

function GenerateRecapControls({
  recapSplitLayout,
  generating,
  generateDisabled,
  onGenerate,
}: {
  recapSplitLayout: boolean
  generating: boolean
  generateDisabled: boolean
  onGenerate: () => void
}) {
  if (recapSplitLayout) {
    return (
      <XStack
        width="100%"
        justifyContent="space-between"
        alignItems="flex-start"
        flexWrap="wrap"
        gap="$3"
      >
        <YStack flex={1} minWidth={220} gap="$1.5" maxWidth={560}>
          <Text fontSize={16} fontWeight="700" color="$color" letterSpacing={-0.2}>
            Regenerate recap
          </Text>
          <Text fontSize="$2" lineHeight={20} color="$placeholderColor">
            Runs the recap model again on your saved beats and notes, using the AI preference switches above in the
            prompt.
          </Text>
        </YStack>
        <XStack gap="$2" alignItems="center" flexShrink={0} flexWrap="wrap">
          {generating ? <Spinner size="small" color="$brand" /> : null}
          <AppButton size="$3" variant="primary" onPress={onGenerate} disabled={generateDisabled}>
            {generating ? 'Generating…' : 'Generate Recap'}
          </AppButton>
        </XStack>
      </XStack>
    )
  }
  return (
    <YStack width="100%" gap="$3">
      <YStack gap="$1.5" width="100%">
        <Text fontSize={16} fontWeight="700" color="$color" letterSpacing={-0.2}>
          Regenerate recap
        </Text>
        <Text fontSize="$2" lineHeight={20} color="$placeholderColor">
          Runs the recap model again on your saved beats and notes, using the AI preference switches above in the
          prompt.
        </Text>
      </YStack>
      <XStack width="100%" gap="$2" alignItems="center" justifyContent="flex-start">
        {generating ? <Spinner size="small" color="$brand" /> : null}
        <AppButton
          size="$3"
          variant="primary"
          onPress={onGenerate}
          disabled={generateDisabled}
          flex={1}
          minHeight={44}
        >
          {generating ? 'Generating…' : 'Generate Recap'}
        </AppButton>
      </XStack>
    </YStack>
  )
}

function SwitchRow({
  label,
  description,
  checked,
  onChange,
  isLast,
}: {
  label: string
  /** Omit to keep the share row scannable (design: progressive disclosure). */
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
  isLast?: boolean
}) {
  const theme = useTheme()
  /** Slate track so the “off” rail is visible on `$backgroundHover` in light and dark (not a white thumb on near-white). */
  const trackOff = '#64748B'
  const trackOn =
    (theme.brand?.val as string | undefined) ??
    (theme.blue9?.val as string | undefined) ??
    palette.brand
  const thumb = palette.white

  return (
    <YStack
      paddingVertical="$2.5"
      borderBottomWidth={isLast ? 0 : 1}
      borderBottomColor="$borderColor"
    >
      <XStack alignItems="center" justifyContent="space-between" gap="$3" minHeight={44}>
        <YStack flex={1} minWidth={0} gap="$0.5" paddingRight="$2">
          <Text fontSize="$3" fontWeight="600" color="$color">
            {label}
          </Text>
          {description ? (
            <Text fontSize="$2" color="$colorSecondary" lineHeight={20}>
              {description}
            </Text>
          ) : null}
        </YStack>
        <RNSwitch
          accessibilityLabel={label}
          value={checked}
          onValueChange={onChange}
          trackColor={{ false: trackOff, true: trackOn }}
          thumbColor={thumb}
          ios_backgroundColor={trackOff}
        />
      </XStack>
    </YStack>
  )
}

export default function DealRecapScreen() {
  const router = useRouter()
  const theme = useTheme()
  const { width } = useScreenWidth()
  const recapSplitLayout = width >= 900
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>()
  const sid = typeof sessionId === 'string' ? sessionId : (sessionId?.[0] ?? '')

  const [recap, setRecap] = useState<DealRecap | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [hideQuotes, setHideQuotes] = useState(false)
  const [hideDealer, setHideDealer] = useState(false)
  const [hideDollars, setHideDollars] = useState(false)
  const [shareTextBusy, setShareTextBusy] = useState(false)
  const [pdfShareBusy, setPdfShareBusy] = useState<RecapPdfVariant | null>(null)
  /** Web only: PNG is one continuous image (no print pagination). */
  const [recapExportFormat, setRecapExportFormat] = useState<'pdf' | 'png'>('pdf')
  const [timelineEditing, setTimelineEditing] = useState(false)
  const [timelineError, setTimelineError] = useState<string | null>(null)
  const [shareHint, setShareHint] = useState<string | null>(null)
  const [shareInlineError, setShareInlineError] = useState<string | null>(null)
  const shareHintClearRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flashShareHint = useCallback((text: string) => {
    if (shareHintClearRef.current != null) clearTimeout(shareHintClearRef.current)
    setShareHint(text)
    shareHintClearRef.current = setTimeout(() => {
      setShareHint(null)
      shareHintClearRef.current = null
    }, 5000)
  }, [])

  const load = useCallback(async () => {
    if (!sid) {
      setLoading(false)
      setRecap(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const r = await api.getDealRecap(sid)
      setRecap(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load recap')
    } finally {
      setLoading(false)
    }
  }, [sid])

  useEffect(() => {
    void load()
  }, [load])

  const redactionProfile = (): DealRecapRedactionProfile => ({
    hideUserMessageQuotes: hideQuotes,
    hideDealerName: hideDealer,
    hideDollarAmounts: hideDollars,
  })

  const handleGenerate = async () => {
    if (!sid) return
    setGenerating(true)
    setError(null)
    setTimelineError(null)
    try {
      const r = await api.generateDealRecap(sid, { force: true, redaction: redactionProfile() })
      setRecap(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const handleShareText = async () => {
    if (!sid) return
    setShareInlineError(null)
    setShareTextBusy(true)
    try {
      const p = await api.getDealRecapSharePreview(sid, SHARE_PREVIEW_UNMASKED)
      const lines = p.beats.map((b) => {
        const bits = [b.world, b.app].map((s) => s.trim()).filter((s) => s.length > 0)
        return `• ${bits.join(' — ')}`
      })
      const body = [lines.join('\n'), '', p.savings.disclaimer].join('\n')
      await shareRecapText('Deal recap', body)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      if (Platform.OS === 'web') {
        setShareInlineError(`Share failed: ${msg}`)
      } else {
        recapNotify('Share failed', msg)
      }
    } finally {
      setShareTextBusy(false)
    }
  }

  const handleSharePdf = async (variant: RecapPdfVariant) => {
    if (!sid) return
    setShareInlineError(null)

    const wantPng = Platform.OS === 'web' && recapExportFormat === 'png'

    let printTarget: Window | null = null
    if (Platform.OS === 'web' && !wantPng) {
      printTarget = globalThis.open?.('about:blank', '_blank') ?? null
      if (printTarget == null) {
        setShareInlineError('Could not open a new window. Allow pop-ups to print or save as PDF.')
        return
      }
      try {
        printTarget.opener = null
      } catch {
        /* noop */
      }
    }

    setPdfShareBusy(variant)
    const disposePrintTarget = () => {
      if (printTarget == null || printTarget.closed) return
      try {
        printTarget.close()
      } catch {
        /* noop */
      }
    }

    try {
      const p = await api.getDealRecapSharePreview(sid, SHARE_PREVIEW_UNMASKED)
      if (variant === 'timeline' && p.beats.length === 0) {
        const msg = 'There are no timeline events to export yet.'
        if (Platform.OS === 'web') {
          setShareInlineError(msg)
        } else {
          recapNotify('Timeline PDF', msg)
        }
        disposePrintTarget()
        return
      }
      const title =
        variant === 'timeline' ? 'Deal timeline' : variant === 'savings' ? 'Savings snapshot' : 'Deal recap'
      const html = buildDealRecapPdfHtml({ variant, beats: p.beats, savings: p.savings, title })

      if (wantPng) {
        const base =
          variant === 'timeline' ? 'deal-recap-timeline' : variant === 'savings' ? 'deal-recap-savings' : 'deal-recap-full'
        await shareDealRecapPngFromHtml(html, base)
        flashShareHint('Image ready — your browser may share it or download the PNG.')
      } else {
        await shareDealRecapPdfFromHtml(
          html,
          `Share ${title}`,
          Platform.OS === 'web' ? { targetWindow: printTarget } : undefined
        )
        if (Platform.OS === 'web') {
          flashShareHint('Print dialog opened — choose “Save as PDF” if you want a file.')
        }
      }
    } catch (e) {
      disposePrintTarget()
      const msg = e instanceof Error ? e.message : 'Unknown error'
      if (Platform.OS === 'web') {
        setShareInlineError(`Export failed: ${msg}`)
      } else {
        recapNotify('PDF share failed', msg)
      }
    } finally {
      setPdfShareBusy(null)
    }
  }

  const shareControlsDisabled = shareTextBusy || pdfShareBusy !== null || !sid || timelineEditing
  const exportFileLabel = Platform.OS === 'web' && recapExportFormat === 'png' ? 'PNG' : 'PDF'

  return (
    <ThemedSafeArea edges={['top', 'left', 'right']}>
      <YStack flex={1}>
        <ScreenHeader
          leftIcon={<ChevronLeft size={24} color="$color" />}
          onLeftPress={() => router.back()}
          leftLabel="Back"
          title="Deal recap"
        />
        {loading ? (
          <YStack flex={1} alignItems="center" justifyContent="center">
            <LoadingIndicator />
          </YStack>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
            style={
              appScrollViewChromeStyle((theme.placeholderColor?.val as string) ?? palette.overlay) as any
            }
            contentContainerStyle={{
              paddingHorizontal: recapSplitLayout ? 22 : 18,
              paddingTop: recapSplitLayout ? 8 : 6,
              paddingBottom: 64,
            }}
          >
            <YStack width="100%" maxWidth={1040} alignSelf="center" gap={recapSplitLayout ? '$5' : '$4'}>
              {!sid ? (
                <YStack padding="$3" borderRadius="$3" borderWidth={1} borderColor="$borderColor" backgroundColor="$backgroundHover">
                  <Text fontSize="$3" fontWeight="600" color="$color">
                    Invalid recap link
                  </Text>
                  <Text fontSize="$2" color="$colorSecondary" marginTop="$1" lineHeight={20}>
                    Open Deal recap from chat so the session is included in the URL.
                  </Text>
                </YStack>
              ) : null}
              {error ? (
                <YStack
                  padding="$3"
                  borderRadius="$3"
                  borderWidth={1}
                  borderColor="$red8"
                  backgroundColor="$red2"
                >
                  <Text color="$red11" fontSize="$3" fontWeight="600">
                    Something went wrong
                  </Text>
                  <Text color="$red10" fontSize="$2" marginTop="$1">
                    {error}
                  </Text>
                </YStack>
              ) : null}

              {!loading && sid && !recap ? (
                <AppCard compact>
                  <GenerateRecapControls
                    recapSplitLayout={recapSplitLayout}
                    generating={generating}
                    generateDisabled={generating || !sid}
                    onGenerate={() => void handleGenerate()}
                  />
                </AppCard>
              ) : null}

              {recap ? (
                <>
                  <YStack width="100%" gap="$2" marginBottom={recapSplitLayout ? '$5' : '$4'}>
                    <RecapSectionLabel>AI recap preferences</RecapSectionLabel>
                    <AppCard compact>
                      <YStack gap="$4" width="100%">
                        <YStack gap="$2" width="100%">
                          <Text fontSize={16} fontWeight="700" color="$color" letterSpacing={-0.2}>
                            Next AI pass only
                          </Text>
                          <Text fontSize="$2" color="$placeholderColor" lineHeight={20}>
                            These switches only steer the model when you tap “Generate Recap” or “Save and regenerate”.
                            They do not change the story on screen or what Share & export sends until you regenerate.
                          </Text>
                          <Text fontSize="$2" color="$placeholderColor" lineHeight={20}>
                            Save timeline edits before sharing so exports match what you see.
                          </Text>
                        </YStack>

                        <YStack width="100%" gap="$1.5">
                          <Text
                            fontSize={11}
                            fontWeight="700"
                            letterSpacing={1.1}
                            color="$placeholderColor"
                            textTransform="uppercase"
                          >
                            Steer the next recap toward…
                          </Text>
                          <YStack
                            borderRadius="$3"
                            borderWidth={1}
                            borderColor="$borderColor"
                            backgroundColor="$backgroundHover"
                            overflow="hidden"
                            paddingHorizontal="$2"
                          >
                            <SwitchRow
                              label="Hide chat-quote details"
                              checked={hideQuotes}
                              onChange={setHideQuotes}
                            />
                            <SwitchRow label="Hide dealer name" checked={hideDealer} onChange={setHideDealer} />
                            <SwitchRow
                              label="Hide dollar amounts"
                              checked={hideDollars}
                              onChange={setHideDollars}
                              isLast
                            />
                          </YStack>
                        </YStack>

                        {timelineEditing ? (
                          <YStack
                            padding="$2.5"
                            borderRadius="$3"
                            borderWidth={1}
                            borderColor="$borderColor"
                            backgroundColor="$backgroundHover"
                          >
                            <Text fontSize="$2" color="$orange10" lineHeight={20}>
                              Finish or cancel timeline edits before sharing or exporting.
                            </Text>
                          </YStack>
                        ) : null}

                        <YStack
                          paddingTop="$3"
                          gap="$3"
                          borderTopWidth={1}
                          borderTopColor="$borderColor"
                          width="100%"
                        >
                          <GenerateRecapControls
                            recapSplitLayout={recapSplitLayout}
                            generating={generating}
                            generateDisabled={generating || !sid}
                            onGenerate={() => void handleGenerate()}
                          />
                        </YStack>
                      </YStack>
                    </AppCard>
                  </YStack>

                  <XStack
                    width="100%"
                    flexDirection={recapSplitLayout ? 'row' : 'column'}
                    gap={recapSplitLayout ? '$6' : '$5'}
                    alignItems="flex-start"
                    minWidth={0}
                  >
                    <YStack
                      width="100%"
                      minWidth={0}
                      gap="$2"
                      {...(recapSplitLayout ? ({ flex: 1, flexBasis: 0, flexGrow: 1, flexShrink: 1 } as const) : {})}
                    >
                      {timelineError ? (
                        <Text
                          fontSize="$2"
                          color="$red10"
                          lineHeight={20}
                          padding="$2"
                          borderRadius="$2"
                          backgroundColor="$red2"
                          {...(Platform.OS === 'web' ? ({ role: 'alert' } as const) : { accessibilityRole: 'alert' as const })}
                        >
                          {timelineError}
                        </Text>
                      ) : null}
                      <RecapVerticalTimeline
                        title="Your timeline"
                        subtitle="What changed on the lot and in the app — edit to add, fix, or remove beats."
                        sessionId={sid}
                        activeDealId={recap.activeDealId}
                        eventCount={recap.beats.length}
                        rows={recap.beats.map((b): RecapTimelineRow => {
                          const { world, app } = recapBeatWorldApp(b)
                          return {
                            id: b.id,
                            world,
                            app,
                            occurredAt: b.occurredAt,
                            sortOrder: b.sortOrder,
                          }
                        })}
                        onTimelinePersisted={async () => {
                          setTimelineError(null)
                          await load()
                        }}
                        onEditingChange={setTimelineEditing}
                        getRegenerateRedactionProfile={redactionProfile}
                        onError={(title, message) => {
                          setTimelineError(`${title}: ${message}`)
                          if (Platform.OS !== 'web') {
                            recapNotify(title, message)
                          }
                        }}
                      />
                    </YStack>

                    {!recapSplitLayout ? (
                      <YStack width="100%" height={1} backgroundColor="$borderColor" marginVertical="$1" />
                    ) : null}

                    <YStack
                      width={recapSplitLayout ? 320 : '100%'}
                      flexShrink={0}
                      gap={recapSplitLayout ? '$5' : '$4'}
                      alignSelf="stretch"
                    >
                      <YStack width="100%" gap="$2">
                        <RecapSectionLabel>{recapSplitLayout ? 'Numbers' : 'Deal numbers'}</RecapSectionLabel>
                        <AppCard compact>
                          <Text fontSize={16} fontWeight="700" color="$color" letterSpacing={-0.2}>
                            Savings snapshot
                          </Text>
                          <Text fontSize="$2" lineHeight={18} color="$placeholderColor" marginTop="$1">
                            From deal numbers in chat. Summary is illustrative where noted—same math as Share & export.
                          </Text>
                          <RecapSavingsSnapshotCard savings={recap.savings} />
                        </AppCard>
                      </YStack>

                      <YStack width="100%" gap="$2">
                        <RecapSectionLabel>Share & export</RecapSectionLabel>
                        <AppCard compact>
                          <Text fontSize={16} fontWeight="700" color="$color" letterSpacing={-0.2}>
                            Share recap
                          </Text>
                          <Text fontSize="$2" color="$placeholderColor" marginTop="$1" lineHeight={20}>
                            Plain text or a file—matches the recap you see here. PDF opens print; PNG is one tall image
                            (web).
                          </Text>
                          {Platform.OS !== 'web' ? (
                            <Text fontSize="$2" color="$placeholderColor" marginTop="$1" lineHeight={20}>
                              On your phone, files are PDF only (system share sheet).
                            </Text>
                          ) : null}
                          {recapSplitLayout ? (
                            <>
                              <XStack gap="$2.5" flexWrap="wrap" marginTop="$2" alignItems="center">
                                <AppButton
                                  size="$3"
                                  variant="primary"
                                  onPress={() => void handleShareText()}
                                  disabled={shareControlsDisabled}
                                >
                                  {shareTextBusy ? 'Sharing…' : 'Share text…'}
                                </AppButton>
                              </XStack>
                              {Platform.OS === 'web' ? (
                                <XStack gap="$2" flexWrap="wrap" marginTop="$2" alignItems="center">
                                  <AppButton
                                    size="$2"
                                    variant={recapExportFormat === 'pdf' ? 'primary' : 'outline'}
                                    onPress={() => setRecapExportFormat('pdf')}
                                    disabled={shareControlsDisabled}
                                  >
                                    PDF
                                  </AppButton>
                                  <AppButton
                                    size="$2"
                                    variant={recapExportFormat === 'png' ? 'primary' : 'outline'}
                                    onPress={() => setRecapExportFormat('png')}
                                    disabled={shareControlsDisabled}
                                  >
                                    PNG
                                  </AppButton>
                                </XStack>
                              ) : null}
                              <XStack gap="$2.5" flexWrap="wrap" marginTop="$2" alignItems="center">
                                <AppButton
                                  size="$3"
                                  variant="outline"
                                  onPress={() => void handleSharePdf('timeline')}
                                  disabled={shareControlsDisabled}
                                >
                                  {pdfShareBusy === 'timeline' ? 'Preparing…' : `Timeline ${exportFileLabel}`}
                                </AppButton>
                                <AppButton
                                  size="$3"
                                  variant="outline"
                                  onPress={() => void handleSharePdf('savings')}
                                  disabled={shareControlsDisabled}
                                >
                                  {pdfShareBusy === 'savings' ? 'Preparing…' : `Savings ${exportFileLabel}`}
                                </AppButton>
                                <AppButton
                                  size="$3"
                                  variant="outline"
                                  onPress={() => void handleSharePdf('full')}
                                  disabled={shareControlsDisabled}
                                >
                                  {pdfShareBusy === 'full' ? 'Preparing…' : `Timeline + savings ${exportFileLabel}`}
                                </AppButton>
                              </XStack>
                              {shareHint ? (
                                <Text
                                  fontSize="$2"
                                  color="$brand"
                                  marginTop="$2"
                                  lineHeight={20}
                                  {...(Platform.OS === 'web'
                                    ? ({ 'aria-live': 'polite' } as const)
                                    : { accessibilityLiveRegion: 'polite' as const })}
                                >
                                  {shareHint}
                                </Text>
                              ) : null}
                              {shareInlineError ? (
                                <Text
                                  fontSize="$2"
                                  color="$red10"
                                  marginTop="$2"
                                  lineHeight={20}
                                  {...(Platform.OS === 'web'
                                    ? ({ role: 'alert' } as const)
                                    : { accessibilityRole: 'alert' as const })}
                                >
                                  {shareInlineError}
                                </Text>
                              ) : null}
                            </>
                          ) : (
                            <YStack width="100%" gap="$2" marginTop="$2" alignItems="stretch">
                              <AppButton
                                size="$3"
                                variant="primary"
                                onPress={() => void handleShareText()}
                                disabled={shareControlsDisabled}
                                width="100%"
                                minHeight={44}
                              >
                                {shareTextBusy ? 'Sharing…' : 'Share text…'}
                              </AppButton>
                              {Platform.OS === 'web' ? (
                                <XStack gap="$2" flexWrap="wrap" alignItems="center" width="100%">
                                  <AppButton
                                    size="$2"
                                    variant={recapExportFormat === 'pdf' ? 'primary' : 'outline'}
                                    onPress={() => setRecapExportFormat('pdf')}
                                    disabled={shareControlsDisabled}
                                    flex={1}
                                    minHeight={40}
                                  >
                                    PDF
                                  </AppButton>
                                  <AppButton
                                    size="$2"
                                    variant={recapExportFormat === 'png' ? 'primary' : 'outline'}
                                    onPress={() => setRecapExportFormat('png')}
                                    disabled={shareControlsDisabled}
                                    flex={1}
                                    minHeight={40}
                                  >
                                    PNG
                                  </AppButton>
                                </XStack>
                              ) : null}
                              <AppButton
                                size="$3"
                                variant="outline"
                                onPress={() => void handleSharePdf('timeline')}
                                disabled={shareControlsDisabled}
                                width="100%"
                                minHeight={44}
                              >
                                {pdfShareBusy === 'timeline' ? 'Preparing…' : `Timeline ${exportFileLabel}`}
                              </AppButton>
                              <AppButton
                                size="$3"
                                variant="outline"
                                onPress={() => void handleSharePdf('savings')}
                                disabled={shareControlsDisabled}
                                width="100%"
                                minHeight={44}
                              >
                                {pdfShareBusy === 'savings' ? 'Preparing…' : `Savings ${exportFileLabel}`}
                              </AppButton>
                              <AppButton
                                size="$3"
                                variant="outline"
                                onPress={() => void handleSharePdf('full')}
                                disabled={shareControlsDisabled}
                                width="100%"
                                minHeight={44}
                              >
                                {pdfShareBusy === 'full' ? 'Preparing…' : `Timeline + savings ${exportFileLabel}`}
                              </AppButton>
                              {shareHint ? (
                                <Text
                                  fontSize="$2"
                                  color="$brand"
                                  marginTop="$2"
                                  lineHeight={20}
                                  {...(Platform.OS === 'web'
                                    ? ({ 'aria-live': 'polite' } as const)
                                    : { accessibilityLiveRegion: 'polite' as const })}
                                >
                                  {shareHint}
                                </Text>
                              ) : null}
                              {shareInlineError ? (
                                <Text
                                  fontSize="$2"
                                  color="$red10"
                                  marginTop="$2"
                                  lineHeight={20}
                                  {...(Platform.OS === 'web'
                                    ? ({ role: 'alert' } as const)
                                    : { accessibilityRole: 'alert' as const })}
                                >
                                  {shareInlineError}
                                </Text>
                              ) : null}
                            </YStack>
                          )}
                        </AppCard>
                      </YStack>
                    </YStack>
                  </XStack>
                </>
              ) : null}
            </YStack>
          </ScrollView>
        )}
      </YStack>
    </ThemedSafeArea>
  )
}
