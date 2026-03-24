import { TouchableOpacity } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import type { Scenario } from '@/lib/types'
import { AppCard, StatusPill } from '@/components/shared'

interface ScenarioCardProps {
  scenario: Scenario
  onStart: (id: string) => void
}

const difficultyStatus = {
  easy: 'green' as const,
  medium: 'yellow' as const,
  hard: 'red' as const,
}

export function ScenarioCard({ scenario, onStart }: ScenarioCardProps) {
  return (
    <TouchableOpacity onPress={() => onStart(scenario.id)} activeOpacity={0.7}>
      <AppCard gap="$3">
        <XStack justifyContent="space-between" alignItems="center">
          <Text fontSize={17} fontWeight="700" color="$color">
            {scenario.title}
          </Text>
          <StatusPill
            status={difficultyStatus[scenario.difficulty]}
            label={scenario.difficulty.charAt(0).toUpperCase() + scenario.difficulty.slice(1)}
            size="sm"
          />
        </XStack>

        <Text fontSize={14} color="$placeholderColor" lineHeight={20}>
          {scenario.description}
        </Text>

        <YStack backgroundColor="$backgroundHover" borderRadius="$2" padding="$3" gap="$1">
          <Text
            fontSize={12}
            color="$placeholderColor"
            fontWeight="600"
            textTransform="uppercase"
            letterSpacing={0.5}
          >
            Customer: {scenario.aiPersona.name}
          </Text>
          <Text fontSize={13} color="$color" numberOfLines={2}>
            {scenario.aiPersona.personality}
          </Text>
          <XStack gap="$2" flexWrap="wrap" marginTop="$1">
            {scenario.aiPersona.challenges.map((challenge, i) => (
              <XStack
                key={i}
                backgroundColor="$borderColor"
                borderRadius={100}
                paddingHorizontal="$2"
                paddingVertical="$1"
              >
                <Text fontSize={11} color="$placeholderColor">
                  {challenge}
                </Text>
              </XStack>
            ))}
          </XStack>
        </YStack>
      </AppCard>
    </TouchableOpacity>
  )
}
