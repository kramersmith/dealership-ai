# ADR-0027: Buyer Copilot Visual Identity — Single Dark Theme + Manrope Font System

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Kramer Smith

## Context

The mobile app shipped with a Facebook-inspired dark/light theme pair, a user-toggleable `themeStore` (Zustand), and Tamagui's default Inter font. Two pressures pushed against this:

1. **Visual identity drift.** The buyer copilot product has a specific "Stitch / Haggle-aligned" visual reference — slate-950 page background, emerald primary accents, violet hero pill, frosted slate panels. The Facebook palette could not express it without per-screen overrides.
2. **No real product need for light mode.** The buyer use case (running this app at a dealership, often outdoors or under poor lighting) and the dealer training simulations both target the same dark surface. Maintaining a parallel light theme cost design + QA effort with no adopter.

The font situation was similar: Inter was Tamagui's default rather than a design choice. The new design language calls for a body font (Manrope), a display font for hero headlines / wordmark / card titles (Outfit), and a monospaced font for prices, timers, comp distances, and timestamps (JetBrains Mono).

## Decision

Adopt a single, fixed dark visual identity for the mobile app, powered by Tamagui themes plus three Google-fonts loaded at app boot:

1. **Single app-wide theme: `dark_copilot`.**
   - `app/_layout.tsx` hard-pins `defaultTheme="dark_copilot"` and wraps the tree in `<Theme name="dark_copilot">`. There is no runtime switch.
   - `dark_copilot` is defined in `lib/theme/themes.ts` as a Stitch-aligned scope: slate-950 base (`#030712`), emerald primary (`#34d399` / pressed `#10b981`), violet accents (`#c4b5fd`), and frosted slate panels.
   - Existing `lightTheme` / `light_*` sub-themes remain in `themes.ts` as dead code for now (no callers); they will be removed in a follow-up sweep once it's clear no screen wants to opt into them.
   - The `themeStore` (Zustand store with `mode`/`toggle`) is **deleted** — no consumer remains, so the abstraction is gone, not stubbed out.

2. **Three-font system loaded via `@expo-google-fonts`.**
   - `Manrope` (body, weights 400/500/600/700/800), `Outfit` (display, weights 300/400/500/600/700), `JetBrains Mono` (mono, 400/500). Loaded by `useFonts(...)` in `app/_layout.tsx` alongside the existing Inter fallbacks.
   - `lib/theme/manropeFont.ts` exposes `createManropeFont(...)` — a Tamagui `createFont` builder that wires the loaded font names into native (`face` map keyed by weight → loaded font name) and a CSS stack on web (`MANROPE_WEB_STACK`).
   - `tamagui.config.ts` now sets both `fonts.body` and `fonts.heading` to Manrope variants (heading uses size/letter-spacing/transform overrides for hero/uppercase use).
   - `lib/constants.ts` exports `WEB_FONT_FAMILY` (Manrope), `DISPLAY_FONT_FAMILY` (Outfit), and `MONO_FONT_FAMILY` (JetBrains Mono) for contexts where Tamagui fonts don't cascade — primarily RN Web `Modal` portals (see `modalWebTypography.ts`).

3. **Color tokens consolidated in `lib/theme/tokens.ts`.** A new `palette.copilot*` namespace holds slate scale, emerald tints/borders, violet badges, ghost-pressable surfaces, frosted chrome surfaces, and chat bubble backgrounds. JS-side surfaces (`StyleSheet.create`, inline styles) reference `palette.*` directly so style objects without `useTheme()` access stay aligned with the theme.

## Alternatives Considered

### Option A: Keep the dark/light split with `themeStore`
- Pros: Optionality preserved; users who prefer light can have it.
- Cons: Doubles design-review surface for every new screen. The new buyer copilot identity is explicitly dark — a light variant would either look off-brand or require a full second design pass. No real demand from any user we've seen.

### Option B: Use `useColorScheme()` from React Native (system theme follow)
- Pros: No store needed, follows OS preference, common pattern.
- Cons: Same problem as Option A — we'd need a designed-out light variant. Also surrenders the visual decision to OS chrome rather than owning it.

### Option C: Skip Google Fonts; ship with Inter only
- Pros: Smaller bundle, fewer font load events to manage on web cold start.
- Cons: Inter does not match the design reference. The hero/wordmark needs a display face (Outfit) and prices/timers need a mono face (JetBrains Mono) for legibility — neither is well-served by Inter. Loading three Google Fonts adds ~2-3 woff2 files; acceptable cost.

### Option D: Embed font binaries via `expo-font` directly
- Pros: No Google Fonts dependency; full control over which weights ship.
- Cons: `@expo-google-fonts/*` already wraps `expo-font` and version-pins each weight. Direct embedding would just mean copying the same files manually. The `@expo-google-fonts` packages give us tree-shaking per weight via `require('@expo-google-fonts/manrope').Manrope_400Regular`.

## Consequences

- **Positive:** Visual identity is now owned in one place (`dark_copilot` theme + `palette.copilot*` tokens). No screen needs to override the base theme to look on-brand.
- **Positive:** Removing `themeStore` removes a subscription-shaped re-render path from `RootLayout` and one fewer Zustand store to keep in mind.
- **Positive:** The font loading lives entirely in `app/_layout.tsx` with `useFonts` gating render until ready (`if (!loaded) return null`). No flash-of-fallback-font on first paint after the splash screen lifts.
- **Negative:** Light mode is dead. If the product later needs an outdoor-readable light variant (e.g., for buyers using the app in direct sun on a lot), that's a new design pass plus reviving the `lightTheme` wiring. The dead `light*` blocks in `themes.ts` are kept as a starting point but must be removed in the follow-up sweep if no consumer materializes.
- **Negative:** Three Google Fonts add web bundle weight (woff2 self-hosted via `@expo-google-fonts`). For native this is free at runtime (font files are bundled into the app binary). On web cold start, fonts swap in once `useFonts` resolves; the `MANROPE_WEB_STACK` fallback keeps text shape stable.
- **Neutral:** The `WEB_FONT_FAMILY` constant changed from `Inter, …` to `Manrope, …`. Any RN Web Modal portal that explicitly read this constant gets the new family automatically; any place that hard-coded `'Inter'` is wrong and needs updating (none found at the time of this ADR).
- **Neutral:** Tamagui's `$color1`–`$color12` scale is remapped in `dark_copilot` to slate-aligned values, so any component that relies on the default Tamagui dark scale will pick up the new identity automatically.

## References

- [`apps/mobile/app/_layout.tsx`](../../apps/mobile/app/_layout.tsx) — single-theme root + `useFonts` Manrope/Outfit/JetBrainsMono.
- [`apps/mobile/lib/theme/themes.ts`](../../apps/mobile/lib/theme/themes.ts) — `darkCopilotTheme` definition.
- [`apps/mobile/lib/theme/tokens.ts`](../../apps/mobile/lib/theme/tokens.ts) — `palette.copilot*` and slate scale.
- [`apps/mobile/lib/theme/manropeFont.ts`](../../apps/mobile/lib/theme/manropeFont.ts) — Tamagui `createFont` builder for Manrope.
- [`apps/mobile/tamagui.config.ts`](../../apps/mobile/tamagui.config.ts) — `fonts.body` + `fonts.heading` wired to Manrope; `themes.dark_copilot` registered.
- `docs/ui-design-principles.md` — broader UI standards (touch targets, micro-interactions).
