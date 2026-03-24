import { useEffect, useRef } from 'react'
import { FlatList, Animated } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { ThemedSafeArea, HamburgerMenu, LoadingIndicator, RoleGuard } from '@/components/shared'
import { useRouter } from 'expo-router'
import { Swords } from '@tamagui/lucide-icons'
import { useSimulationStore } from '@/stores/simulationStore'
import { useChatStore } from '@/stores/chatStore'
import { ScenarioCard } from '@/components/simulation'
import { useFadeIn, useSlideIn } from '@/hooks/useAnimatedValue'

function EmptySimulationsState() {
  const opacity = useFadeIn(500)
  return (
    <Animated.View style={{ flex: 1, opacity }}>
      <YStack flex={1} justifyContent="center" alignItems="center" padding="$6" gap="$3">
        <Swords size={48} color="$borderColor" />
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
  }, [])

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

  return (
    <RoleGuard role="dealer">
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
              Training
            </Text>
            <XStack width={44} />
          </XStack>

          {isLoading ? (
            <LoadingIndicator message="Loading scenarios..." />
          ) : scenarios.length === 0 ? (
            <EmptySimulationsState />
          ) : (
            <FlatList
              data={scenarios}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 16 }}
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
        </YStack>
      </ThemedSafeArea>
    </RoleGuard>
  )
}
