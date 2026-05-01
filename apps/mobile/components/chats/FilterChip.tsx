import { useRef, useState, type ComponentType } from 'react'
import { Dimensions, Modal, Platform, Pressable, View } from 'react-native'
import { YStack, Text } from 'tamagui'
import { Check } from '@tamagui/lucide-icons'
import { palette } from '@/lib/theme/tokens'
import { useHoverState } from '@/hooks/useHoverState'
import { modalWebFontFamilyStyle } from '@/lib/modalWebTypography'

export interface FilterChipOption<TValue extends string> {
  value: TValue
  label: string
}

interface FilterChipProps<TValue extends string> {
  /** Lucide icon component rendered inside the chip. */
  icon: ComponentType<{ size?: number; color?: string }>
  /** Static label rendered after the icon (e.g. "Sort By"). */
  label: string
  /** Currently-selected option value. Pass `null` for "no selection" (default). */
  value: TValue | null
  /** Available options. The selected one is highlighted in the dropdown. */
  options: readonly FilterChipOption<TValue>[]
  onSelect: (value: TValue) => void
  /** Disabled chips render dimmed and don't open the dropdown. */
  disabled?: boolean
  /** Optional badge — when truthy, renders an emerald dot on the chip. */
  active?: boolean
}

/**
 * Compact filter chip with a dropdown menu — used in the chat-list search row
 * for Status / Date Range / Sort By. Matches the rest of the design system:
 * 32-tall pill (44 hit area), rgba ghost surface that brightens on hover, and
 * a frosted slate-900 dropdown with a rounded corner.
 */
export function FilterChip<TValue extends string>({
  icon: Icon,
  label,
  value,
  options,
  onSelect,
  disabled = false,
  active = false,
}: FilterChipProps<TValue>) {
  const [isOpen, setIsOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<View>(null)
  const { isHovered, hoverHandlers } = useHoverState(disabled)

  const openMenu = () => {
    if (disabled) return
    if (!buttonRef.current) {
      setIsOpen(true)
      return
    }
    buttonRef.current.measureInWindow((x, y, width, height) => {
      const screenWidth = Dimensions.get('window').width
      const menuWidth = 200
      // Right-align the menu with the chip; keep it on-screen.
      const desiredLeft = x + width - menuWidth
      const safeLeft = Math.max(8, Math.min(desiredLeft, screenWidth - menuWidth - 8))
      setMenuPosition({ top: y + height + 6, left: safeLeft })
      setIsOpen(true)
    })
  }

  const handleSelect = (next: TValue) => {
    onSelect(next)
    setIsOpen(false)
  }

  return (
    <>
      <View ref={buttonRef} collapsable={false}>
        <Pressable
          onPress={openMenu}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`${label} filter`}
          accessibilityState={{ disabled, expanded: isOpen }}
          {...hoverHandlers}
          style={({ pressed }) => ({
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
            ...(Platform.OS === 'web'
              ? ({ cursor: disabled ? 'default' : 'pointer' } as any)
              : null),
          })}
        >
          <View
            style={{
              height: 32,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: isHovered ? palette.ghostBgHover : palette.ghostBg,
              borderWidth: 1,
              borderColor: isHovered ? palette.ghostBorderHover : palette.ghostBorder,
              position: 'relative',
              ...(Platform.OS === 'web'
                ? ({
                    transition: 'background-color 160ms ease, border-color 160ms ease',
                  } as any)
                : null),
            }}
          >
            <Icon size={14} color={palette.slate300} />
            <Text fontSize={13} fontWeight="600" color={palette.slate200}>
              {label}
            </Text>
            {active ? (
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  backgroundColor: '#34d399',
                  marginLeft: 2,
                }}
              />
            ) : null}
          </View>
        </Pressable>
      </View>

      <Modal
        visible={isOpen && menuPosition !== null}
        transparent
        animationType="none"
        onRequestClose={() => setIsOpen(false)}
      >
        <Pressable
          style={{ flex: 1, ...modalWebFontFamilyStyle() }}
          onPress={() => setIsOpen(false)}
        >
          {menuPosition ? (
            <Pressable
              onPress={(event) => event.stopPropagation()}
              style={{
                position: 'absolute',
                top: menuPosition.top,
                left: menuPosition.left,
              }}
            >
              <Dropdown options={options} selected={value} onSelect={handleSelect} />
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>
    </>
  )
}

function Dropdown<TValue extends string>({
  options,
  selected,
  onSelect,
}: {
  options: readonly FilterChipOption<TValue>[]
  selected: TValue | null
  onSelect: (value: TValue) => void
}) {
  return (
    <YStack
      backgroundColor="rgba(15, 23, 42, 0.95)"
      borderRadius={12}
      borderWidth={1}
      borderColor={palette.ghostBorder}
      paddingVertical={4}
      minWidth={200}
      {...(Platform.OS === 'web'
        ? ({
            style: {
              backdropFilter: 'blur(20px) saturate(1.15)',
              WebkitBackdropFilter: 'blur(20px) saturate(1.15)',
            },
          } as any)
        : {})}
    >
      {options.map((opt) => (
        <DropdownRow
          key={opt.value}
          label={opt.label}
          selected={opt.value === selected}
          onPress={() => onSelect(opt.value)}
        />
      ))}
    </YStack>
  )
}

function DropdownRow({
  label,
  selected,
  onPress,
}: {
  label: string
  selected: boolean
  onPress: () => void
}) {
  const { isHovered, hoverHandlers } = useHoverState()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="menuitem"
      accessibilityState={{ selected }}
      {...hoverHandlers}
      style={({ pressed }) => ({
        height: 36,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        marginHorizontal: 4,
        borderRadius: 8,
        backgroundColor: isHovered ? palette.ghostBgSubtle : 'transparent',
        opacity: pressed ? 0.85 : 1,
        ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null),
      })}
    >
      <Text
        fontSize={13}
        color={selected ? palette.slate50 : palette.slate300}
        fontWeight={selected ? '600' : '500'}
      >
        {label}
      </Text>
      {selected ? <Check size={14} color="#34d399" /> : null}
    </Pressable>
  )
}
