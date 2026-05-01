import { useMemo, useState } from 'react'
import { Platform } from 'react-native'

interface UseHoverStateResult {
  isHovered: boolean
  hoverHandlers: { onMouseEnter?: () => void; onMouseLeave?: () => void }
}

/**
 * Web-only hover tracking for `Pressable` / `TouchableOpacity` surfaces. On
 * native platforms the handlers object is empty and `isHovered` stays false.
 * Pass `disabled` to suppress hover transitions on disabled controls.
 */
export function useHoverState(disabled = false): UseHoverStateResult {
  const [isHovered, setIsHovered] = useState(false)

  const hoverHandlers = useMemo(
    () =>
      Platform.OS === 'web' && !disabled
        ? {
            onMouseEnter: () => setIsHovered(true),
            onMouseLeave: () => setIsHovered(false),
          }
        : {},
    [disabled]
  )

  return { isHovered, hoverHandlers }
}
