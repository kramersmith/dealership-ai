import { useRef, useEffect } from 'react'
import { Animated, TextInput, TouchableOpacity } from 'react-native'
import { XStack, YStack, Text, useTheme } from 'tamagui'
import { Pencil } from '@tamagui/lucide-icons'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { AppCard } from '@/components/shared'
import { useEditableField } from '@/hooks/useEditableField'

interface NumberRow {
  label: string
  value: string
  field?: string
  highlight?: 'good' | 'bad' | 'neutral'
  secondary?: boolean
}

interface NumberGroup {
  key: string
  rows: NumberRow[]
}

interface NumbersCardProps {
  title: string
  content: Record<string, any>
  dealId: string | null
  onCorrectNumber?: (dealId: string, field: string, value: number | null) => void
}

function parseNumberInput(raw: string): number | null {
  const cleaned = raw.replace(/[$,%\s]/g, '').replace(/,/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

function NumberRowItem({
  row,
  dealId,
  onCorrectNumber,
}: {
  row: NumberRow
  dealId: string | null
  onCorrectNumber?: (dealId: string, field: string, value: number | null) => void
}) {
  const flash = useRef(new Animated.Value(0)).current
  const theme = useTheme()
  const editable = !!row.field && !!dealId && !!onCorrectNumber
  const isSecondary = !!row.secondary

  const { isEditing, editValue, justSaved, startEditing, setEditValue, commitEdit } =
    useEditableField(row.value, (newVal) => {
      if (row.field && dealId && onCorrectNumber) {
        onCorrectNumber(dealId, row.field, parseNumberInput(newVal))
      }
    })

  useEffect(() => {
    if (row.value !== '—') {
      flash.setValue(1)
      Animated.timing(flash, {
        toValue: 0,
        duration: 600,
        useNativeDriver: USE_NATIVE_DRIVER,
      }).start()
    }
  }, [row.value, flash])

  const valueColor =
    row.highlight === 'good' ? '$positive' : row.highlight === 'bad' ? '$danger' : undefined

  return (
    <Animated.View
      style={{ opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [1, 0.7] }) }}
    >
      <XStack justifyContent="space-between" alignItems="center" paddingVertical="$1.5">
        <Text fontSize={isSecondary ? 12 : 13} color="$placeholderColor" fontWeight="500">
          {row.label}
        </Text>
        {isEditing ? (
          <XStack
            backgroundColor="$backgroundHover"
            borderRadius="$2"
            paddingHorizontal="$2"
            paddingVertical="$1"
          >
            <TextInput
              value={editValue}
              onChangeText={setEditValue}
              onBlur={commitEdit}
              onSubmitEditing={commitEdit}
              autoFocus
              keyboardType="numeric"
              style={{
                fontSize: isSecondary ? 12 : 14,
                fontWeight: isSecondary ? '500' : '700',
                color: theme.color?.val as string,
                textAlign: 'right',
                padding: 0,
                margin: 0,
                minWidth: 60,
              }}
            />
          </XStack>
        ) : editable ? (
          <TouchableOpacity
            onPress={startEditing}
            activeOpacity={0.6}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <XStack alignItems="center" gap="$1.5">
              <Text
                fontSize={isSecondary ? 12 : 14}
                fontWeight={isSecondary ? '500' : '700'}
                color={valueColor ?? '$color'}
              >
                {row.value}
              </Text>
              <Pencil size={10} color="$placeholderColor" opacity={0.5} />
            </XStack>
          </TouchableOpacity>
        ) : (
          <Text
            fontSize={isSecondary ? 12 : 14}
            fontWeight={isSecondary ? '500' : '700'}
            color={valueColor ?? '$color'}
          >
            {row.value}
          </Text>
        )}
      </XStack>
      {justSaved && (
        <Text fontSize={11} fontWeight="500" color="$brand" textAlign="right">
          Saved — AI will use this next
        </Text>
      )}
    </Animated.View>
  )
}

export function NumbersCard({ title, content, dealId, onCorrectNumber }: NumbersCardProps) {
  const groups = (content.groups as NumberGroup[]) ?? []
  const rows = (content.rows as NumberRow[]) ?? []

  // Support both grouped and flat row formats
  const allGroups: NumberGroup[] =
    groups.length > 0 ? groups : rows.length > 0 ? [{ key: 'default', rows }] : []

  if (allGroups.length === 0) return null

  return (
    <AppCard compact gap="$2">
      <Text
        fontSize={12}
        fontWeight="600"
        color="$placeholderColor"
        textTransform="uppercase"
        letterSpacing={0.5}
      >
        {title}
      </Text>
      {allGroups.map((group, gi) => (
        <YStack key={group.key}>
          {gi > 0 && <YStack height={1} backgroundColor="$borderColor" marginVertical="$2" />}
          {group.rows.map((row) => (
            <NumberRowItem
              key={row.label}
              row={row}
              dealId={dealId}
              onCorrectNumber={onCorrectNumber}
            />
          ))}
        </YStack>
      ))}
    </AppCard>
  )
}
