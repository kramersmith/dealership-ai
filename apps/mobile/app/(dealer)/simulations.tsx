import { useEffect } from 'react'
import { FlatList } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { ThemedSafeArea } from '@/components/shared'
import { useRouter } from 'expo-router'
import { Swords } from '@tamagui/lucide-icons'
import { useSimulationStore } from '@/stores/simulationStore'
import { useChatStore } from '@/stores/chatStore'
import { HamburgerMenu, LoadingIndicator } from '@/components/shared'
import { ScenarioCard } from '@/components/simulation'

export default function SimulationsScreen() {
  const router = useRouter()
  const { scenarios, isLoading, loadScenarios, startSimulation } = useSimulationStore()
  const setActiveSession = useChatStore((s) => s.setActiveSession)

  useEffect(() => {
    loadScenarios()
  }, [])

  const handleStart = async (scenarioId: string) => {
    const sessionId = await startSimulation(scenarioId)
    await setActiveSession(sessionId)
    router.push(`/(dealer)/sim/${sessionId}`)
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
            Training
          </Text>
          <XStack width={40} />
        </XStack>

        {isLoading ? (
          <LoadingIndicator message="Loading scenarios..." />
        ) : scenarios.length === 0 ? (
          <YStack flex={1} justifyContent="center" alignItems="center" padding="$6" gap="$3">
            <Swords size={48} color="$borderColor" />
            <Text fontSize={16} fontWeight="600" color="$color">No scenarios available</Text>
          </YStack>
        ) : (
          <FlatList
            data={scenarios}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 16 }}
            ItemSeparatorComponent={() => <YStack height={12} />}
            renderItem={({ item }) => (
              <ScenarioCard scenario={item} onStart={handleStart} />
            )}
          />
        )}
      </YStack>
    </ThemedSafeArea>
  )
}
