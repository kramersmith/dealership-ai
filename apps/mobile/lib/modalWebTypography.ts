import { Platform } from 'react-native'
import { WEB_FONT_FAMILY } from '@/lib/constants'

/** RN Web `Modal` portals do not inherit app font tokens; merge into backdrop/root views. */
export function modalWebFontFamilyStyle(): { fontFamily: string } | Record<string, never> {
  return Platform.OS === 'web' ? { fontFamily: WEB_FONT_FAMILY } : {}
}
