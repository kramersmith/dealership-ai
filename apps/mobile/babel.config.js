module.exports = function (api) {
  api.cache(true)

  const plugins = []

  // Tamagui static extraction requires native modules (react-native) that
  // can't be loaded in a plain Node.js context (e.g. Docker web builds).
  // Only enable when bundling for a native platform.
  if (process.env.EXPO_OS) {
    plugins.push([
      '@tamagui/babel-plugin',
      {
        components: ['tamagui'],
        config: './tamagui.config.ts',
      },
    ])
  }

  // must be last
  plugins.push('react-native-reanimated/plugin')

  return {
    presets: ['babel-preset-expo'],
    plugins,
  }
}
