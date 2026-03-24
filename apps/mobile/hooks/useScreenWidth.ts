import { useState, useEffect } from 'react'
import { Dimensions } from 'react-native'

const DESKTOP_BREAKPOINT = 768

export function useScreenWidth() {
  const [width, setWidth] = useState(Dimensions.get('window').width)

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setWidth(window.width)
    })
    return () => subscription.remove()
  }, [])

  return {
    width,
    isDesktop: width >= DESKTOP_BREAKPOINT,
  }
}
