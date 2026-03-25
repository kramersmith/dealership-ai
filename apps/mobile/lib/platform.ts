import { Platform } from 'react-native'

/**
 * Whether Animated should use the native driver.
 * On web, useNativeDriver is not supported — fall back to the JS driver.
 */
export const USE_NATIVE_DRIVER = Platform.OS !== 'web'
