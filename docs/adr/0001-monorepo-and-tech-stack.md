# ADR-0001: Monorepo and Tech Stack

**Status:** Accepted
**Date:** 2026-03
**Deciders:** Kramer Smith

## Context

Dealership AI needs to ship two AI-powered smartphone apps (buyer and dealer) with a shared backend. The project is a solo-developer, pre-production MVP with a tight budget. Key requirements:

- Cross-platform mobile (iOS + Android) with web support for development and demo purposes
- Real-time AI integration with the Claude API for conversational assistance and structured tool calls
- A persistent dashboard UI that updates live from LLM tool calls (deal numbers, scorecard, vehicle info, checklist)
- Fast iteration speed for a solo developer — minimal boilerplate, strong typing, good DX

The tech stack needs to balance developer productivity, cross-platform reach, AI SDK compatibility, and runtime performance.

## Decision

Adopt a monorepo with the following stack:

- **Monorepo** — single repository with `apps/mobile` (frontend) and `apps/backend` (backend), plus shared `docs/`
- **FastAPI** (Python) — backend framework
- **React Native + Expo** — cross-platform mobile framework with web support
- **Tamagui** — UI component library with native performance and web compatibility
- **Zustand** — lightweight client-side state management
- **Claude API** (Anthropic) — LLM with tool_use for structured dashboard updates
- **SQLAlchemy + Alembic** — ORM and migrations (SQLite for dev, PostgreSQL for production)

## Alternatives Considered

### Option A: Separate repositories (frontend + backend)
- Pros: Independent deployment, clearer ownership boundaries in a team setting
- Cons: Harder to keep shared types in sync, more CI/CD complexity, slower iteration for a solo developer who touches both sides frequently

### Option B: Next.js full-stack (single app)
- Pros: Single language (TypeScript), server components for streaming, simpler deployment
- Cons: No native mobile app (web-only or requires a separate React Native app anyway), Python has the best Claude SDK and AI ecosystem support, would still need a separate backend for mobile API

### Option C: Flutter instead of React Native
- Pros: Strong cross-platform performance, single codebase for iOS/Android/web
- Cons: Dart ecosystem is smaller, fewer UI libraries for this use case, less familiarity, weaker web story for responsive layouts

### Option D: Redux or Jotai instead of Zustand
- Pros: Redux has larger ecosystem and devtools; Jotai is more atomic
- Cons: Redux has significant boilerplate for this project size; Jotai's atomic model is less intuitive for the dashboard state shape (single deal state object updated by tool calls). Zustand's simplicity and minimal API are ideal for MVP scope.

### Option E: Express.js / Node.js backend
- Pros: Single language across the stack (TypeScript everywhere)
- Cons: Python has the official Anthropic SDK with native streaming support, better ecosystem for AI/ML tooling, and FastAPI's async + Pydantic validation is well-suited for the streaming SSE architecture

## Consequences

- **Positive:** Co-located code enables fast iteration — changing a tool call schema updates backend models, SSE events, and frontend types in one commit. Python backend gives first-class Claude SDK support with native async streaming. Expo provides iOS/Android/web from one codebase. Zustand keeps state management simple and readable.
- **Positive:** Tamagui compiles styles to native views on mobile and optimized CSS on web, avoiding the performance penalty of typical React Native web bridges.
- **Negative:** Two languages (Python + TypeScript) means no shared type definitions — API contracts must be manually kept in sync between Pydantic schemas and TypeScript interfaces.
- **Negative:** Monorepo requires a unified Makefile and careful directory structure to keep concerns separated.
- **Neutral:** The monorepo can be split later if the project grows to multiple developers, but for MVP scope this is unlikely to be needed.

## References

- [Architecture doc](../architecture.md)
- [Backend plan](../backend-plan.md)
- [Anthropic Python SDK](https://github.com/anthropics/anthropic-sdk-python)
- [Expo documentation](https://docs.expo.dev/)
- [Tamagui documentation](https://tamagui.dev/)
