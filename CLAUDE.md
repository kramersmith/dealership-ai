# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Dealership AI** is a B2B SaaS platform for the automotive industry — an AI-powered app for real-time, in-person showroom floor assistance. Two user personas: car buyers (understand deals, spot unauthorized charges) and salespeople (real-time objection coaching, automated CRM capture). Core differentiator: no competitor addresses in-person showroom interactions; all existing tools are post-deal, VoIP-based, or contact-center-focused.

## Current State

This project is in the **research and planning phase** — no source code, build system, or dependencies exist yet. Key artifacts:
- `notes.md` — project vision, features, architecture, legal requirements, and business model
- `research.json` — comprehensive research output (2.2 MB) covering feasibility, technical requirements, legal analysis, market context, and competitor landscape

## Build Priority (Feature Sequence)

1. **Deal Decoder** — parses bundled deal numbers into plain English; no audio recording needed (lowest legal risk)
2. **Live Objection Coach** — real-time spoken objection detection with <300ms p95 latency; requires consent flow and hardware
3. **Customer Intel Logger** — auto-captures buyer signals to CRM (VinSolutions, DealerSocket); requires CRM integrations
4. **F&I Add-on Scanner** — real-time unauthorized charge detection; highest impact but highest legal complexity

## Architecture: Edge-First Hybrid

- **Edge (on-premise):** NVIDIA Jetson AGX Orin-class gateway, beamforming mic arrays (Shure MXA / Sennheiser TCC), lapel mics. Handles VAD, noise suppression, speaker diarization, and streaming ASR.
- **Cloud:** Async LLM processing, conversation summarization, encrypted storage, CRM/DMS sync, model training, analytics.
- **ASR path:** Start with Deepgram Nova-3 or AssemblyAI Universal-2 → migrate to fine-tuned Whisper on edge. Target >90% accuracy with domain tuning.
- **NLP pipeline:** Entity extraction, speaker diarization, intent classification, semantic parsing with confidence gating.

## Key Integrations

- **DMS:** Dealertrack, RouteOne, CDK, Reynolds
- **CRM:** VinSolutions, DealerSocket, DriveCentric
- **Document processing:** OCR for contract/PDF parsing

## Legal & Compliance (Critical)

**Consent is a hard prerequisite for any audio feature.** All audio features must implement a geo-aware consent flow that detects state and triggers the correct consent mechanism before capture.

- California and Illinois require **all-party consent** for recording
- Illinois BIPA classifies voiceprints as biometric identifiers — requires **written consent + retention schedule** before any IL operation
- Default to all-party consent in ambiguous jurisdictions
- GLBA Safeguards apply (conversations contain NPI) — encryption + access controls required
- Marketing opt-ins (TCPA/CCPA) must be captured separately from recording consent
- Deal Decoder output requires advisory disclaimers (not legal/financial advice)
- Maintain auditable chain-of-custody for all recordings and consent receipts
