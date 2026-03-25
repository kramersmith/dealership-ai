# UI Design Principles for Dealership AI

**Last updated:** 2026-03-25

This document explains core UX concepts that drive the frontend design. AI agents and engineers should reference it when building or refining interfaces to ensure consistent, trustworthy, and low-friction user experiences.

> **Mobile-first is the top priority.** All design and implementation decisions must start from mobile breakpoints and small screens, then scale up. Desktop/web is an enhancement, not the default.

## Table of Contents

- [1. Mobile-First (Top Priority)](#1-mobile-first-top-priority)
- [2. The Halo Effect](#2-the-halo-effect)
- [3. Engineering First Impressions](#3-engineering-first-impressions)
- [4. War on Cognitive Load](#4-war-on-cognitive-load)
- [5. Micro-interactions](#5-micro-interactions)
- [6. Theme Architecture](#6-theme-architecture)
- [7. Quick Reference for Agents](#7-quick-reference-for-agents)

---

## 1. Mobile-First (Top Priority)

### What It Means

**Mobile-first** means designing and building for the smallest viewport first, then progressively enhancing for larger screens. The default mental model is a phone in hand—not a desktop monitor. Every layout, component, and interaction must work on touch devices and narrow widths before being refined for desktop.

### Why It Is Top Priority

- Buyers use this app at the dealership on their phones. Salespeople use it on the floor. The primary context is always mobile.
- Starting with mobile forces focus on essential content and reduces bloat.
- Scaling up is easier than scaling down.
- Mobile-first improves performance and accessibility for all users.

### Implementation Requirements

| Requirement | Implementation |
|-------------|----------------|
| **Start with mobile viewports** | Build and test at ~375px width first. |
| **Touch targets** | Buttons and interactive elements must be at least 44×44px for reliable touch. Avoid tiny links or icons that require precision. |
| **Single-column on mobile** | Default to stacked layouts. Dense data becomes cards or simplified lists. |
| **Progressive enhancement** | Add multi-column layouts, hover states, and desktop-specific features only after the mobile experience is solid. |
| **No hover-only interactions** | Critical actions must work on tap. Hover is for enhancement only—never the only way to access key functionality. |

### Checklist for Every Screen

1. Does it work and look correct on a 375px viewport?
2. Are all interactive elements at least 44×44px?
3. Can the primary action be completed with thumb reach?
4. Is there a mobile-friendly alternative for any dense data layout?
5. Have desktop layouts been added *after* mobile is done?

---

## 2. The Halo Effect

### What It Is

The **halo effect** is a cognitive bias: users' perception of one positive trait (e.g. visual polish) influences how they judge everything else about a product. If something *looks* good, users assume it *works* well—even without evidence. The reverse is true: a clunky or inconsistent interface creates a "devil effect" where users distrust the whole product.

### Why It Matters

First impressions form within seconds. A polished screen signals professionalism and builds trust before users interact with functionality. Conversely, off-brand or rough visuals make users hesitant, even when the underlying logic is solid.

### How to Apply It

| Principle | Implementation |
|-----------|----------------|
| **Strong first screens** | Invest in the chat screen, onboarding, and initial views. These set the tone. |
| **Polish overlooked states** | Empty states, error screens, and loading views matter as much as happy-path screens. |
| **Visual consistency** | Use shared components, spacing, typography, and color tokens across the app. |
| **Subtle motion** | Smooth transitions and restrained animations feel premium; jarring or missing motion feels cheap. |

---

## 3. Engineering First Impressions

### What It Means

"Engineering first impressions" means designing UI so that the *first moment* a user sees a screen communicates quality, clarity, and intent. It is not about flashy effects—it is about deliberate visual hierarchy, spacing, and structure.

### Design Strategies

- **Clear visual hierarchy** – Primary content (e.g. deal numbers, vehicle name) should stand out. Secondary content (labels, metadata) should recede via size, weight, or color.
- **Breathing room** – Generous but consistent spacing reduces visual noise and makes content easier to scan.
- **Predictable structure** – Use familiar patterns (e.g. cards for data, primary CTAs above the fold) so users know where to look.
- **Immediate affordance** – Buttons should look clickable; links should look tappable. Avoid flat, ambiguous elements.

### Checklist for New Screens

1. Is the primary action obvious within 2 seconds?
2. Is there a clear focal point, or is the eye scattered?
3. Do empty and error states feel intentional, not "broken"?
4. Is spacing consistent with the rest of the app?

---

## 4. War on Cognitive Load

### What Cognitive Load Is

**Cognitive load** is the mental effort required to use an interface. When it is too high, users make more mistakes, take longer to complete tasks, or abandon them. This is especially critical for Dealership AI — buyers are already stressed and under pressure at the dealership.

### Principles for Reducing Load

| Principle | Implementation |
|-----------|----------------|
| **Chunking** | Group related information. The dashboard is chunked: numbers, scorecard, vehicle, checklist are separate cards. |
| **Progressive disclosure** | The dashboard is collapsible. Show what matters now, hide what doesn't. |
| **Fewer choices at once** | Quick actions are limited to 3, ordered by relevance (most useful first). The chat is the primary interaction. |
| **Consistent patterns** | Reuse layouts and interaction patterns so users build muscle memory. |
| **Defaults and shortcuts** | Quick action buttons send pre-written prompts. The AI proactively updates the dashboard. |
| **Clear labels** | Use short, scannable section headers to orient users quickly. |

### Anti-Patterns to Avoid

- Dense walls of text or data with no grouping
- Every option given equal weight (no hierarchy). For dynamic suggestions like quick actions, position-based ordering (most relevant first) provides hierarchy without visual noise.
- Ambiguous or redundant labels
- Asking for information the system already has

---

## 5. Micro-interactions

### What They Are

**Micro-interactions** are small, single-purpose feedback loops: trigger → response. They communicate that the system received input, changed state, or is processing. On mobile, tap/active feedback is primary; hover effects are enhancement only.

### Why They Matter

Micro-interactions make interfaces feel responsive and human instead of static and mechanical. They:

- Confirm actions ("I tapped, something happened")
- Guide attention (e.g. loading states, dashboard updates)
- Add polish without adding complexity

### Design Guidelines

| Element | Recommendation |
|---------|----------------|
| **Buttons** | Active: slight scale change. Use smooth transitions for feedback. |
| **Cards** | Hover (desktop): subtle lift. Tap (mobile): opacity change. |
| **Dashboard updates** | When numbers change from a chat response, they should feel alive — not just silently swap. |
| **Empty states** | Fade in so empty content feels intentional, not unfinished. |

### Restraint

Micro-interactions should be **subtle and fast**. Avoid:

- Long or bouncy animations
- Competing or distracting motion
- Effects that delay critical feedback

---

## 6. Theme Architecture

### Structure

All colors are defined in the Tamagui theme system, split into two files under `lib/theme/`:

- **`tokens.ts`** -- Defines the raw color palette (`palette`) and maps palette values to semantic token names (`tokenColors`). This is the single source of truth for every color in the app.
- **`themes.ts`** -- Defines dark and light themes by mapping token names to theme keys, plus semantic sub-themes (`danger`, `warning`, `success`) for status surfaces in both modes.

The `tamagui.config.ts` file imports from these theme files and registers everything with Tamagui.

### Usage Rules

| Rule | Implementation |
|------|----------------|
| **No hardcoded hex values** | Every color must come from the theme system. Never write `#FF0000` or `rgb(...)` in a component. |
| **Use `useTheme()` for dynamic values** | When you need a color in JavaScript (e.g., for `Animated.View` or non-Tamagui components), call `useTheme()` and reference the theme key. |
| **Use `<Theme name="...">` for semantic surfaces** | Wrap components in `<Theme name="danger">`, `<Theme name="warning">`, or `<Theme name="success">` to apply status-colored backgrounds and text. The sub-theme sets `background` and `color` automatically. |
| **Use Tamagui style props for simple cases** | For Tamagui components, use props like `backgroundColor="$background"` or `color="$color"` to reference theme tokens directly. |
| **Score/status colors via sub-themes** | Scorecard ratings (`red`, `yellow`, `green`) and similar status indicators should use the `danger`, `warning`, `success` sub-themes rather than mapping colors manually. |

### Adding New Colors

1. Add the raw color to `palette` in `tokens.ts`.
2. Map it to a semantic token name in `tokenColors`.
3. Reference the token in `themes.ts` for both dark and light themes.
4. If it represents a status, add or update the corresponding sub-theme.

---

## 7. Quick Reference for Agents

When building or refining UI:

1. **Mobile-first (top priority)** – Design and implement for small viewports first. Touch targets ≥44px. No hover-only actions. Scale up to desktop only after mobile is solid.
2. **Halo effect** – Polish first screens, empty states, and error views. Keep visual language consistent.
3. **First impressions** – Establish clear hierarchy, spacing, and focal points. Make the primary action obvious.
4. **Cognitive load** – Chunk content, limit choices per screen, use clear labels and familiar patterns. Buyers are stressed — reduce their mental effort.
5. **Micro-interactions** – Add tap/active feedback, entrance animations, and loading states. Keep them fast and subtle. Touch is primary; hover is enhancement only.
6. **Theme compliance** – No hardcoded hex values. Use Tamagui theme tokens (`$background`, `$color`, etc.), `useTheme()` for JS values, and `<Theme name="danger|warning|success">` wrappers for status surfaces. All colors defined in `lib/theme/tokens.ts`.
7. **Touch targets** – All interactive elements must be at least 44×44px.
