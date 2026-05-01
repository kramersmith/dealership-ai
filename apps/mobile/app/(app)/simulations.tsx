import { useEffect, useRef } from 'react'
import { Animated, FlatList, View } from 'react-native'
import { YStack, Text } from 'tamagui'
import { Swords } from '@tamagui/lucide-icons'
import { useRouter } from 'expo-router'
import {
  CopilotPageHero,
  CopilotTopNav,
  HamburgerMenu,
  LoadingIndicator,
  RoleGuard,
  ThemedSafeArea,
} from '@/components/shared'
import { palette } from '@/lib/theme/tokens'
import { useSimulationStore } from '@/stores/simulationStore'
import { useChatStore } from '@/stores/chatStore'
import { ScenarioCard } from '@/components/simulation'
import { useFadeIn, useSlideIn } from '@/hooks/useAnimatedValue'
import { PAGE_MAX_WIDTH, PAGE_PADDING_H, PAGE_PADDING_V } from '@/lib/constants'

function EmptySimulationsState() {
  const opacity = useFadeIn(500)
  return (
    <Animated.View style={{ flex: 1, opacity }}>
      <YStack flex={1} justifyContent="center" alignItems="center" padding="$6" gap="$3">
        <Swords size={48} color={palette.ghostBorderHover} />
        <Text fontSize={16} fontWeight="600" color="$color">
          No scenarios available
        </Text>
      </YStack>
    </Animated.View>
  )
}

export default function SimulationsScreen() {
  const router = useRouter()
  const { scenarios, isLoading, loadScenarios, startSimulation } = useSimulationStore()
  const setActiveSession = useChatStore((state) => state.setActiveSession)

  useEffect(() => {
    loadScenarios()
  }, [loadScenarios])

  const isStarting = useRef(false)

  const handleStart = async (scenarioId: string) => {
    if (isStarting.current) return
    isStarting.current = true
    try {
      const sessionId = await startSimulation(scenarioId)
      await setActiveSession(sessionId)
      router.push(`/(app)/sim/${sessionId}`)
    } catch {
      // Error already logged in simulationStore/chatStore
    } finally {
      isStarting.current = false
    }
  }

  const topNav = (
    <CopilotTopNav
      // The dealer hamburger menu is its own self-contained trigger button.
      rightSlot={<HamburgerMenu />}
      paddingHorizontal={PAGE_PADDING_H}
    />
  )

  return (
    <RoleGuard role="dealer">
      <ThemedSafeArea edges={['top']}>
        <YStack flex={1} backgroundColor="$background">
          {topNav}

          <View
            style={{
              flex: 1,
              width: '100%',
              maxWidth: PAGE_MAX_WIDTH,
              alignSelf: 'center',
              paddingHorizontal: PAGE_PADDING_H,
              paddingTop: PAGE_PADDING_V,
              paddingBottom: PAGE_PADDING_V,
            }}
          >
            <CopilotPageHero
              leading="Sharpen your"
              accent="pitch"
              description="Practice against an AI customer that pushes back."
              isDesktop={false}
              caption={null}
            />

            {isLoading ? (
              <LoadingIndicator message="Loading scenarios..." />
            ) : scenarios.length === 0 ? (
              <EmptySimulationsState />
            ) : (
              <FlatList
                data={scenarios}
                keyExtractor={(item) => item.id}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingTop: 4, paddingBottom: 16 }}
                ItemSeparatorComponent={() => <YStack height={12} />}
                renderItem={({ item, index }) => {
                  const AnimatedCard = () => {
                    const { opacity, translateY } = useSlideIn(250, index * 80)
                    return (
                      <Animated.View style={{ opacity, transform: [{ translateY }] }}>
                        <ScenarioCard scenario={item} onStart={handleStart} />
                      </Animated.View>
                    )
                  }
                  return <AnimatedCard />
                }}
              />
            )}
          </View>
        </YStack>
      </ThemedSafeArea>
    </RoleGuard>
  )
}
